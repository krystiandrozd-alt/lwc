import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getInsight from '@salesforce/apex/AccountData360WidgetController.getInsight';

/**
 * DEMO ONLY. Generates a believable Data 360-style profile from the record ID.
 * No Data Cloud, Apex or network calls. Same record ID -> same numbers on every load.
 */

const DRIVER_CATALOG = [
    { key: 'usage', label: 'Data usage down ≥30% vs 3-month avg', points: 20 },
    { key: 'contract', label: 'Contract ends within 60 days', points: 15 },
    { key: 'tenure', label: 'Tenure under 6 months', points: 15 },
    { key: 'cases', label: '3+ service cases in 90 days', points: 10 },
    { key: 'nps', label: 'Last NPS 0–6 (detractor)', points: 10 },
    { key: 'competitor', label: 'Viewed port-out / compare plans pages', points: 10 },
    { key: 'network', label: 'Network experience score below 60', points: 5 },
    { key: 'payment', label: 'Payment score below 50', points: 5 },
];

const OFFER_BY_DRIVER = {
    usage: {
        name: 'Bonus 10 GB for 3 months',
        reason: 'Data usage is falling; re-engage before renewal.',
        prop: 0.31,
        cost: 60,
    },
    contract: {
        name: 'Re-contract 24 months, 20% off',
        reason: 'Contract ends soon; lock in before the renewal window closes.',
        prop: 0.34,
        cost: 1150,
    },
    tenure: {
        name: 'Onboarding call + welcome bundle',
        reason: 'New customer still settling in.',
        prop: 0.45,
        cost: 40,
    },
    cases: {
        name: 'Senior agent callback + bill credit',
        reason: 'Repeated cases; fix the experience first.',
        prop: 0.52,
        cost: 100,
    },
    nps: { name: 'Service recovery call', reason: 'Recent detractor score.', prop: 0.4, cost: 25 },
    competitor: {
        name: 'Loyalty price match',
        reason: 'Signals of comparing competitor offers.',
        prop: 0.28,
        cost: 600,
    },
    network: {
        name: 'Network check + AED 100 credit',
        reason: 'Poor network experience on the main line.',
        prop: 0.5,
        cost: 100,
    },
    payment: {
        name: 'Flexible payment plan',
        reason: 'Late payments; avoid involuntary churn.',
        prop: 0.38,
        cost: 0,
    },
};

const BAND_RANGES = { low: [12, 39], medium: [40, 64], high: [65, 88] };
const MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];

function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededRandom(seed) {
    let a = seed || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const between = (rand, min, max) => Math.round(min + rand() * (max - min));

export function bandFor(score) {
    if (score >= 65) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
}

/** Builds the full fake profile. Exported for unit tests. */
export function buildProfile(recordId, scenario, targetScore) {
    const rand = seededRandom(hashString(recordId || 'demo-record'));
    let level = scenario;
    if (!BAND_RANGES[level]) {
        const r = rand();
        level = r < 0.4 ? 'high' : r < 0.75 ? 'medium' : 'low';
    }
    const [min, max] = BAND_RANGES[level];
    const generated = between(rand, min, max);
    const target =
        targetScore === undefined || targetScore === null
            ? generated
            : Math.max(0, Math.min(100, Math.round(targetScore)));

    // Pick drivers in random order until their points reach the target score.
    const shuffled = [...DRIVER_CATALOG].sort(() => rand() - 0.5);
    const drivers = [];
    let sum = 0;
    for (const d of shuffled) {
        if (sum >= target) break;
        const pts = Math.min(d.points, target - sum);
        drivers.push({ ...d, points: pts });
        sum += pts;
    }
    drivers.sort((a, b) => b.points - a.points);
    const has = (key) => drivers.some((d) => d.key === key);

    const lines = between(rand, 1, 4);
    const arpa = between(rand, 140, 520) * Math.max(1, lines * 0.6);
    const tenureMonths = has('tenure') ? between(rand, 2, 5) : between(rand, 14, 110);
    const score = sum;
    const clv = Math.round(arpa * 36 * (1 - score / 140));
    const networkScore = has('network') ? between(rand, 42, 58) : between(rand, 66, 92);
    const paymentScore = has('payment') ? between(rand, 30, 49) : between(rand, 62, 96);
    const nps = has('nps') ? between(rand, 2, 6) : between(rand, 7, 10);
    const contractDays = has('contract') ? between(rand, 12, 58) : between(rand, 95, 640);
    const openCases = has('cases') ? between(rand, 2, 4) : between(rand, 0, 1);

    const baseGb = between(rand, 18, 45);
    const usage = MONTHS.map((m, i) => {
        let v = baseGb * (0.9 + rand() * 0.2);
        if (i === 6 || i === 7) v *= 1.15; // summer peak
        if (has('usage') && i >= 9) v *= 1 - 0.18 * (i - 8);
        return Math.round(v);
    });
    const trend =
        score > 0
            ? Array.from({ length: 6 }, (_, i) =>
                  Math.max(5, Math.round(score - (5 - i) * (score / 9) + (rand() - 0.5) * 4))
              )
            : [0, 0, 0, 0, 0, 0];
    trend[5] = score;

    const offers = drivers
        .map((d) => ({ key: d.key, ...OFFER_BY_DRIVER[d.key] }))
        .map((o) => ({ ...o, value: Math.round(o.prop * clv - o.cost) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);

    return {
        score,
        band: bandFor(score),
        drivers,
        lines,
        arpa: Math.round(arpa),
        clv,
        tenureMonths,
        networkScore,
        paymentScore,
        nps,
        contractDays,
        openCases,
        usage,
        trend,
        offers,
    };
}

const isSet = (v) => v !== undefined && v !== null && v !== '';

function parseLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((l) => l.split('|').map((s) => s.trim()))
        .filter((parts) => parts[0]);
}

/**
 * Overlays admin-entered Customer_Insight__c values on the generated profile.
 * Blank fields keep the generated value. Exported for unit tests.
 */
export function mergeInsight(recordId, scenario, insight) {
    if (!insight) return buildProfile(recordId, scenario);

    const customDrivers = parseLines(insight.Risk_Drivers__c).map((parts, i) => ({
        key: `custom-driver-${i}`,
        label: parts[0],
        points: Math.max(0, Math.round(Number(parts[1]) || 0)),
    }));
    const driverSum = customDrivers.reduce((a, d) => a + d.points, 0);
    let targetScore = null;
    if (isSet(insight.Churn_Score__c)) targetScore = Number(insight.Churn_Score__c);
    else if (customDrivers.length) targetScore = driverSum;

    const p = buildProfile(recordId, scenario, targetScore);
    if (customDrivers.length) p.drivers = [...customDrivers].sort((a, b) => b.points - a.points);
    if (targetScore !== null) {
        p.score = Math.max(0, Math.min(100, Math.round(targetScore)));
        p.band = bandFor(p.score);
        p.trend[5] = p.score;
    }

    const num = (field, key) => {
        if (isSet(insight[field])) p[key] = Number(insight[field]);
    };
    num('Monthly_Revenue__c', 'arpa');
    num('Lifetime_Value__c', 'clv');
    num('Active_Lines__c', 'lines');
    num('Tenure_Months__c', 'tenureMonths');
    num('Contract_End_Days__c', 'contractDays');
    num('Network_Score__c', 'networkScore');
    num('Payment_Score__c', 'paymentScore');
    num('Last_NPS__c', 'nps');
    num('Open_Cases__c', 'openCases');

    const usage = String(insight.Usage_GB__c || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map(Number)
        .filter((n) => Number.isFinite(n));
    if (usage.length >= 2) p.usage = usage.slice(-12);

    const customOffers = parseLines(insight.Retention_Offers__c).map((parts, i) => {
        const prop = Math.max(0, Math.min(100, Number(parts[2]) || 0)) / 100;
        const cost = Number(parts[3]) || 0;
        return {
            key: `custom-offer-${i}`,
            name: parts[0],
            reason: parts[1] || '',
            prop,
            cost,
            value: Math.round(prop * p.clv - cost),
        };
    });
    if (customOffers.length) {
        p.offers = customOffers.slice(0, 3); // keep the admin's order
    } else {
        p.offers = p.offers.map((o) => ({ ...o, value: Math.round(o.prop * p.clv - o.cost) }));
    }
    return p;
}

export default class AccountData360Widget extends LightningElement {
    @api recordId;
    @api cardTitle = 'Data 360 Customer Insights';
    @api scenario = 'auto';
    @api currencyCode = 'AED';
    @api hideDemoBadge = false;

    insight;

    @wire(getInsight, { recordId: '$recordId' })
    wiredInsight({ data, error }) {
        // A missing object, missing access or no record all fall back to generated values.
        this.insight = error ? null : data || null;
    }

    get profile() {
        return mergeInsight(this.recordId, this.scenario, this.insight);
    }

    get sourceNote() {
        return this.insight
            ? 'Source: Customer Insight (Demo) record, blanks filled with generated values.'
            : 'Source: Data 360 unified profile, calculated insights (demo simulation).';
    }

    get showDemoBadge() {
        return !this.hideDemoBadge;
    }

    // ---------------------------------------------------------------- header
    get bandLabel() {
        return `${this.profile.band} churn risk`;
    }

    get bandBadgeClass() {
        const b = this.profile.band;
        if (b === 'High') return 'slds-badge slds-theme_error';
        if (b === 'Medium') return 'slds-badge slds-theme_warning';
        return 'slds-badge slds-theme_success';
    }

    get scoreMarkerStyle() {
        return `left: calc(${this.profile.score}% - 2px);`;
    }

    get scoreDelta() {
        const t = this.profile.trend;
        const d = t[5] - t[0];
        return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} pts in 6 months`;
    }

    // ---------------------------------------------------------------- KPIs
    get kpis() {
        const p = this.profile;
        const tenure =
            p.tenureMonths >= 12
                ? `${(p.tenureMonths / 12).toFixed(1)} yrs`
                : `${p.tenureMonths} mo`;
        return [
            { key: 'arpa', label: 'Monthly revenue', value: p.arpa, isCurrency: true },
            { key: 'clv', label: 'Lifetime value', value: p.clv, isCurrency: true },
            { key: 'lines', label: 'Active lines', text: String(p.lines) },
            { key: 'tenure', label: 'Tenure', text: tenure },
            {
                key: 'contract',
                label: 'Contract ends',
                text: `${p.contractDays} days`,
                warn: p.contractDays <= 60,
            },
            {
                key: 'network',
                label: 'Network score',
                text: String(p.networkScore),
                warn: p.networkScore < 60,
            },
            {
                key: 'payment',
                label: 'Payment score',
                text: String(p.paymentScore),
                warn: p.paymentScore < 50,
            },
            { key: 'nps', label: 'Last NPS', text: String(p.nps), warn: p.nps <= 6 },
            {
                key: 'cases',
                label: 'Open cases',
                text: String(p.openCases),
                warn: p.openCases >= 2,
            },
        ].map((k) => ({
            ...k,
            valueClass: k.warn ? 'kpi-value slds-text-color_error' : 'kpi-value',
            flag: k.warn ? '▼ needs attention' : '',
        }));
    }

    // ---------------------------------------------------------------- drivers
    get drivers() {
        return this.profile.drivers.map((d) => ({
            ...d,
            barStyle: `width: ${Math.min(100, Math.round((d.points / 20) * 100))}%;`,
            title: `${d.label}: ${d.points} points`,
        }));
    }

    get hasDrivers() {
        return this.profile.drivers.length > 0;
    }

    // ---------------------------------------------------------------- usage sparkline (SVG, no chart library)
    get usagePoints() {
        const u = this.profile.usage;
        const max = Math.max(...u) * 1.1;
        return u
            .map(
                (v, i) =>
                    `${((i / (u.length - 1)) * 300).toFixed(1)},${(60 - (v / max) * 56).toFixed(1)}`
            )
            .join(' ');
    }

    get usageLast() {
        return this.profile.usage[this.profile.usage.length - 1];
    }

    get usageChange() {
        const u = this.profile.usage;
        const last = u[u.length - 1];
        const window = u.slice(-4, -1);
        const prev = window.reduce((a, b) => a + b, 0) / (window.length || 1);
        const pct = prev ? Math.round(((last - prev) / prev) * 100) : 0;
        return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs previous months`;
    }

    get usageChangeClass() {
        const u = this.profile.usage;
        const window = u.slice(-4, -1);
        const prev = window.reduce((a, b) => a + b, 0) / (window.length || 1);
        return u[u.length - 1] < prev * 0.8 ? 'slds-text-color_error' : 'slds-text-color_weak';
    }

    get usageAria() {
        return `Data usage over 12 months, latest ${this.usageLast} GB`;
    }

    // ---------------------------------------------------------------- offers
    get offers() {
        return this.profile.offers.map((o, i) => ({
            ...o,
            rank: i + 1,
            propPct: Math.round(o.prop * 100),
            propStyle: `width: ${Math.round(o.prop * 100)}%;`,
            cardClass: i === 0 ? 'offer offer_top' : 'offer',
            buttonVariant: i === 0 ? 'brand' : 'neutral',
            isTop: i === 0,
        }));
    }

    get hasOffers() {
        return this.profile.offers.length > 0;
    }

    handlePresent(event) {
        const name = event.currentTarget.dataset.name;
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Offer presented (demo)',
                message: `"${name}" logged as presented. In production this writes the outcome back to Data 360.`,
                variant: 'success',
            })
        );
    }
}
