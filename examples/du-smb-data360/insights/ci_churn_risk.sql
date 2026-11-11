-- du_CI_ChurnRisk: latest ingested score per account (snapshot table holds one row per account per month)
SELECT
    r.account_id__c                     AS account_id__c,
    MAX(r.churn_score__c)               AS churn_score__c,
    MAX(r.clv_aed__c)                   AS clv_aed__c,
    MAX(r.nbo_propensity_pct__c)        AS nbo_propensity_pct__c
FROM du_AccountRiskSnapshot__dlm r
WHERE r.snapshot_date__c > date_add(current_date(), -31)
GROUP BY r.account_id__c
-- Text attributes (band, drivers, NBO name) are read from the DMO through the data graph, not the insight:
-- insights aggregate measures; strings stay on the snapshot record.
