import { LightningElement, api } from 'lwc';
import getKpiDefinitions from '@salesforce/apex/DataCloudDashboardController.getKpiDefinitions';
import runKpi from '@salesforce/apex/DataCloudDashboardController.runKpi';
import getSegments from '@salesforce/apex/DataCloudDashboardController.getSegments';

const SEGMENT_COLUMNS = [
    { label: 'Segment', fieldName: 'displayName', wrapText: true },
    { label: 'Segment on', fieldName: 'segmentOnApiName' },
    { label: 'Type', fieldName: 'segmentType', initialWidth: 120 },
    {
        label: 'Status',
        fieldName: 'segmentStatus',
        initialWidth: 130,
        cellAttributes: { class: { fieldName: 'segmentStatusClass' } },
    },
    {
        label: 'Publish status',
        fieldName: 'publishStatus',
        initialWidth: 140,
        cellAttributes: { class: { fieldName: 'publishStatusClass' } },
    },
    { label: 'Interval', fieldName: 'publishInterval', initialWidth: 120 },
    {
        label: 'Next publish',
        fieldName: 'nextPublishDateTime',
        type: 'date',
        typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        },
    },
];

// Status values are free-text strings from the Connect API; this mapping is a heuristic.
const ERROR_PATTERN = /(ERROR|FAIL)/i;
const OK_PATTERN = /(ACTIVE|SUCCESS|PUBLISHED|COMPLETED)/i;

export function statusTone(value) {
    if (!value) {
        return 'neutral';
    }
    if (ERROR_PATTERN.test(value)) {
        return 'error';
    }
    if (OK_PATTERN.test(value)) {
        return 'success';
    }
    return 'warning';
}

function toneClass(value) {
    const tone = statusTone(value);
    if (tone === 'error') return 'slds-text-color_error';
    if (tone === 'success') return 'slds-text-color_success';
    return '';
}

function errorMessage(error) {
    if (!error) return 'Unknown error';
    if (Array.isArray(error.body)) return error.body.map((e) => e.message).join(', ');
    if (error.body && error.body.message) return error.body.message;
    return error.message || String(error);
}

export default class DataCloudDashboard extends LightningElement {
    @api cardTitle = 'Data 360 Dashboard';
    @api spaceName = 'default';
    @api segmentPageSize = 50;
    @api hideSegments = false;

    kpis = [];
    segments = [];
    segmentColumns = SEGMENT_COLUMNS;
    definitionsError;
    segmentsError;
    loadingDefinitions = true;
    loadingSegments = false;
    lastRefreshed;

    connectedCallback() {
        this.refresh();
    }

    // ------------------------------------------------------------ getters

    get metricKpis() {
        return this.kpis.filter((k) => k.isMetric);
    }

    get tableKpis() {
        return this.kpis.filter((k) => !k.isMetric);
    }

    get hasMetrics() {
        return this.metricKpis.length > 0;
    }

    get hasTables() {
        return this.tableKpis.length > 0;
    }

    get noKpis() {
        return !this.loadingDefinitions && !this.definitionsError && this.kpis.length === 0;
    }

    get showSegments() {
        return !this.hideSegments;
    }

    get hasSegments() {
        return this.segments.length > 0;
    }

    get noSegments() {
        return !this.loadingSegments && !this.segmentsError && this.segments.length === 0;
    }

    get segmentSummary() {
        const total = this.segments.length;
        let ok = 0;
        let failed = 0;
        for (const s of this.segments) {
            const tone = statusTone(s.publishStatus);
            if (tone === 'success') ok++;
            if (tone === 'error') failed++;
        }
        return [
            { key: 'total', label: 'Segments', value: total, cls: 'summary-value' },
            {
                key: 'ok',
                label: 'Publish OK',
                value: ok,
                cls: 'summary-value slds-text-color_success',
            },
            {
                key: 'failed',
                label: 'Publish errors',
                value: failed,
                cls: failed ? 'summary-value slds-text-color_error' : 'summary-value',
            },
            {
                key: 'other',
                label: 'Other / pending',
                value: total - ok - failed,
                cls: 'summary-value',
            },
        ];
    }

    get isRefreshing() {
        return this.loadingDefinitions || this.loadingSegments || this.kpis.some((k) => k.loading);
    }

    // ------------------------------------------------------------ actions

    handleRefresh() {
        this.refresh();
    }

    async refresh() {
        const jobs = [this.loadKpis()];
        if (this.showSegments) {
            jobs.push(this.loadSegments());
        }
        await Promise.all(jobs);
        this.lastRefreshed = new Date().toISOString();
    }

    async loadKpis() {
        this.loadingDefinitions = true;
        this.definitionsError = undefined;
        try {
            const defs = await getKpiDefinitions();
            this.kpis = (defs || []).map((d) => ({
                ...d,
                isMetric: d.displayType !== 'Table',
                loading: true,
                error: undefined,
                value: undefined,
                columns: [],
                rows: [],
                truncated: false,
            }));
        } catch (e) {
            this.definitionsError = errorMessage(e);
            this.kpis = [];
        } finally {
            this.loadingDefinitions = false;
        }
        // Run all KPI queries in parallel; each tile resolves independently.
        await Promise.all(this.kpis.map((k) => this.loadKpi(k.name)));
    }

    async loadKpi(name) {
        try {
            const res = await runKpi({ kpiName: name, dataspace: this.spaceName });
            this.patchKpi(name, this.toKpiState(res));
        } catch (e) {
            this.patchKpi(name, { loading: false, error: errorMessage(e) });
        }
    }

    toKpiState(res) {
        const columns = (res && res.columns) || [];
        const rawRows = (res && res.rows) || [];
        const rows = rawRows.map((r, i) => ({ ...r, _key: String(i) }));
        const first = rawRows.length && columns.length ? rawRows[0][columns[0]] : undefined;
        const numeric = typeof first === 'number';
        return {
            loading: false,
            error: undefined,
            value: first === undefined || first === null ? '—' : first,
            isNumeric: numeric,
            columns: columns.map((c) => ({ label: c, fieldName: c })),
            rows,
            rowCount: rows.length,
            truncated: !!(res && res.truncated),
        };
    }

    patchKpi(name, patch) {
        this.kpis = this.kpis.map((k) => (k.name === name ? { ...k, ...patch } : k));
    }

    async loadSegments() {
        this.loadingSegments = true;
        this.segmentsError = undefined;
        try {
            const data = await getSegments({
                batchSize: this.segmentPageSize,
                offset: 0,
                dataspace: this.spaceName,
            });
            this.segments = (data || []).map((s, i) => ({
                ...s,
                key: s.id || s.apiName || String(i),
                segmentStatusClass: toneClass(s.segmentStatus),
                publishStatusClass: toneClass(s.publishStatus),
            }));
        } catch (e) {
            this.segmentsError = errorMessage(e);
            this.segments = [];
        } finally {
            this.loadingSegments = false;
        }
    }
}
