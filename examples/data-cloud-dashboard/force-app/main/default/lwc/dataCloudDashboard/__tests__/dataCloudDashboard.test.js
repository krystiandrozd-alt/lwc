import { createElement } from 'lwc';
import DataCloudDashboard, { statusTone } from 'c/dataCloudDashboard';
import getKpiDefinitions from '@salesforce/apex/DataCloudDashboardController.getKpiDefinitions';
import runKpi from '@salesforce/apex/DataCloudDashboardController.runKpi';
import getSegments from '@salesforce/apex/DataCloudDashboardController.getSegments';

jest.mock(
    '@salesforce/apex/DataCloudDashboardController.getKpiDefinitions',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
jest.mock('@salesforce/apex/DataCloudDashboardController.runKpi', () => ({ default: jest.fn() }), {
    virtual: true,
});
jest.mock(
    '@salesforce/apex/DataCloudDashboardController.getSegments',
    () => ({ default: jest.fn() }),
    {
        virtual: true,
    }
);

const DEFS = [
    { name: 'Total_Individuals', label: 'Individuals', displayType: 'Metric', sortOrder: 10 },
    {
        name: 'Sample_Individuals',
        label: 'Sample Individuals',
        displayType: 'Table',
        sortOrder: 100,
    },
];

const SEGMENTS = [
    {
        id: '1',
        apiName: 'A',
        displayName: 'Churn risk',
        publishStatus: 'SUCCESS',
        segmentStatus: 'ACTIVE',
    },
    {
        id: '2',
        apiName: 'B',
        displayName: 'Upsell 5G',
        publishStatus: 'ERROR',
        segmentStatus: 'ACTIVE',
    },
    {
        id: '3',
        apiName: 'C',
        displayName: 'New',
        publishStatus: 'PROCESSING',
        segmentStatus: 'ACTIVE',
    },
];

// Resolve all pending promises (several chained awaits in the component).
const flush = async () => {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
};

function mount(props = {}) {
    const el = createElement('c-data-cloud-dashboard', { is: DataCloudDashboard });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

describe('c-data-cloud-dashboard', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('renders metric tiles, table KPIs and segment summary', async () => {
        getKpiDefinitions.mockResolvedValue(DEFS);
        runKpi.mockImplementation(({ kpiName }) =>
            Promise.resolve(
                kpiName === 'Total_Individuals'
                    ? { columns: ['total'], rows: [{ total: 1234 }], truncated: false }
                    : {
                          columns: ['ssot__FirstName__c'],
                          rows: [{ ssot__FirstName__c: 'Ada' }],
                          truncated: false,
                      }
            )
        );
        getSegments.mockResolvedValue(SEGMENTS);

        const el = mount({ spaceName: 'telco' });
        await flush();

        expect(runKpi).toHaveBeenCalledWith({ kpiName: 'Total_Individuals', dataspace: 'telco' });
        expect(getSegments).toHaveBeenCalledWith({ batchSize: 50, offset: 0, dataspace: 'telco' });

        const metric = el.shadowRoot.querySelector('[data-id="metric"]');
        expect(metric.querySelector('lightning-formatted-number').value).toBe(1234);

        const table = el.shadowRoot.querySelector('[data-id="table"] lightning-datatable');
        expect(table.data).toHaveLength(1);
        expect(table.columns).toEqual([
            { label: 'ssot__FirstName__c', fieldName: 'ssot__FirstName__c' },
        ]);

        const summary = [...el.shadowRoot.querySelectorAll('[data-id="segment-summary"]')].map(
            (n) => n.querySelectorAll('p')[1].textContent
        );
        expect(summary).toEqual(['3', '1', '1', '1']);
    });

    it('shows per-tile and segment errors without breaking the rest', async () => {
        getKpiDefinitions.mockResolvedValue([DEFS[0]]);
        runKpi.mockRejectedValue({ body: { message: 'No access to DMO' } });
        getSegments.mockRejectedValue({ body: { message: 'Segments unavailable' } });

        const el = mount();
        await flush();

        expect(el.shadowRoot.querySelector('[data-id="metric"]').textContent).toContain(
            'No access to DMO'
        );
        expect(el.shadowRoot.querySelector('[data-id="segments-error"]').textContent).toBe(
            'Segments unavailable'
        );
    });

    it('can hide the segments section and shows empty-state for no KPIs', async () => {
        getKpiDefinitions.mockResolvedValue([]);

        const el = mount({ hideSegments: true });
        await flush();

        expect(getSegments).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('[data-id="segments"]')).toBeNull();
        expect(el.shadowRoot.querySelector('[data-id="no-kpis"]')).not.toBeNull();
    });

    it('maps status strings to tones', () => {
        expect(statusTone('SUCCESS')).toBe('success');
        expect(statusTone('Publish_Error')).toBe('error');
        expect(statusTone('PROCESSING')).toBe('warning');
        expect(statusTone(undefined)).toBe('neutral');
    });
});
