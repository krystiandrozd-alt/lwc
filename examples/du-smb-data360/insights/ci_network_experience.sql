-- du_CI_NetworkExperience: 30-day network experience per account (standard Network Usage DMO)
SELECT
    n.ssot__AccountId__c                                    AS account_id__c,
    AVG(n.ssot__AverageCallDropRate__c)                     AS avg_call_drop_pct__c,
    AVG(n.ssot__AverageCallSetupSuccessRate__c)             AS avg_setup_success_pct__c,
    AVG(n.ssot__AverageThroughputDownloadNumber__c)         AS avg_dl_mbps__c,
    MAX(n.ssot__AverageCallDropRate__c)                     AS worst_day_drop_pct__c
FROM ssot__NetworkUsage__dlm n
WHERE n.ssot__NetworkUsageStartDateTime__c > date_add(current_date(), -30)
GROUP BY n.ssot__AccountId__c
