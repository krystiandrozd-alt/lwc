import { createElement } from 'lwc';
import AccountData360Widget, { buildProfile, bandFor, mergeInsight } from 'c/accountData360Widget';
const SHOW_TOAST = 'lightning__showtoast'; // event name used by the ShowToastEvent stub
import getInsight from '@salesforce/apex/AccountData360WidgetController.getInsight';

jest.mock(
    '@salesforce/apex/AccountData360WidgetController.getInsight',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

function mount(props) {
    const el = createElement('c-account-data360-widget', { is: AccountData360Widget });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

describe('c-account-data360-widget', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('is deterministic per record ID', () => {
        expect(buildProfile('001AAA', 'auto')).toEqual(buildProfile('001AAA', 'auto'));
        expect(buildProfile('001AAA', 'auto')).not.toEqual(buildProfile('001BBB', 'auto'));
    });

    it.each(['high', 'medium', 'low'])(
        'scenario %s lands in its band and drivers sum to the score',
        (s) => {
            for (const id of ['001A', '001B', '001C', '001D']) {
                const p = buildProfile(id, s);
                expect(p.band.toLowerCase()).toBe(s);
                expect(p.drivers.reduce((a, d) => a + d.points, 0)).toBe(p.score);
                expect(p.offers.length).toBeLessThanOrEqual(3);
            }
        }
    );

    it('maps scores to bands', () => {
        expect(bandFor(10)).toBe('Low');
        expect(bandFor(40)).toBe('Medium');
        expect(bandFor(65)).toBe('High');
    });

    it('renders KPIs, drivers and offers, and toasts on present', async () => {
        const el = mount({ recordId: '001XYZ', scenario: 'high' });
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('[data-id="band"]').textContent).toBe('High churn risk');
        expect(el.shadowRoot.querySelectorAll('[data-id="kpi"]').length).toBe(9);
        expect(el.shadowRoot.querySelectorAll('[data-id="driver"]').length).toBeGreaterThan(0);
        const offers = el.shadowRoot.querySelectorAll('[data-id="offer"]');
        expect(offers.length).toBeGreaterThan(0);

        const handler = jest.fn();
        el.addEventListener(SHOW_TOAST, handler);
        offers[0].querySelector('lightning-button').dispatchEvent(new CustomEvent('click'));
        expect(handler).toHaveBeenCalled();
    });

    it('can hide the demo badge', async () => {
        const el = mount({ recordId: '001XYZ', hideDemoBadge: true });
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('.slds-badge_lightest')).toBeNull();
    });

    it('uses Customer Insight record values and falls back for blanks', async () => {
        const el = mount({ recordId: '001REC', scenario: 'low' });
        getInsight.emit({
            Churn_Score__c: 78,
            Monthly_Revenue__c: 424,
            Lifetime_Value__c: 18400,
            Risk_Drivers__c: 'Contract ends within 60 days | 15\nNetwork complaint | 10',
            Retention_Offers__c: 'Re-contract 24 months | Contract ends soon | 34 | 1150',
            Usage_GB__c: '41, 44, 39, 46, 30, 27',
        });
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('[data-id="band"]').textContent).toBe('High churn risk');
        expect(el.shadowRoot.querySelector('.score').textContent).toBe('78');
        expect(el.shadowRoot.querySelectorAll('[data-id="driver"]').length).toBe(2);
        expect(el.shadowRoot.querySelectorAll('[data-id="offer"]').length).toBe(1);
        expect(el.shadowRoot.querySelector('[data-id="source"]').textContent).toContain(
            'Customer Insight (Demo)'
        );
    });

    it('derives the score from drivers when Churn Score is blank', () => {
        const p = mergeInsight('001X', 'auto', { Risk_Drivers__c: 'A | 20\nB | 25\nC | 5' });
        expect(p.score).toBe(50);
        expect(p.band).toBe('Medium');
        expect(p.drivers[0].points).toBe(25);
    });

    it('falls back to generated values when the wire errors', async () => {
        const el = mount({ recordId: '001ERR', scenario: 'high' });
        getInsight.error();
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('[data-id="band"]').textContent).toBe('High churn risk');
    });
});
