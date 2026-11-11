-- du_CI_ServicePayment: two insights in one file; create them separately in the builder.

-- (a) du_CI_Service: tickets and SLA breaches in 90 days
SELECT
    t.account_id__c                                                 AS account_id__c,
    COUNT(t.ticket_id__c)                                           AS tickets_90d__c,
    SUM(CASE WHEN t.within_sla__c = false THEN 1 ELSE 0 END)        AS sla_breaches_90d__c,
    SUM(CASE WHEN t.priority__c = 'P1' THEN 1 ELSE 0 END)           AS p1_tickets_90d__c
FROM du_TroubleTicket__dlm t
WHERE t.opened_at__c > date_add(current_date(), -90)
GROUP BY t.account_id__c;

-- (b) du_CI_Payment: payment behaviour over 6 bills
SELECT
    b.account_id__c                                                 AS account_id__c,
    AVG(b.days_late__c)                                             AS avg_days_late__c,
    SUM(CASE WHEN b.days_late__c > 0 THEN 1 ELSE 0 END)             AS late_bills_6m__c,
    SUM(CASE WHEN b.is_disputed__c = true THEN 1 ELSE 0 END)        AS disputed_bills_6m__c,
    AVG(b.net_amount_aed__c)                                        AS avg_bill_net_aed__c
FROM du_BillSummary__dlm b
WHERE b.bill_month__c > date_add(current_date(), -185)
GROUP BY b.account_id__c
