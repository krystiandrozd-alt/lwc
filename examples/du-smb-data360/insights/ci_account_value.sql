-- du_CI_AccountValue: one row per account
SELECT
    a.ssot__BillToAccountId__c                                              AS account_id__c,
    COUNT(a.ssot__Id__c)                                                    AS active_lines__c,
    SUM(a.ssot__CurrentMRRAmount__c)                                        AS mrc_aed__c,
    SUM(CASE WHEN a.Is5gDevice__c = true THEN 1 ELSE 0 END)                 AS lines_5g_device__c
FROM ssot__Asset__dlm a
WHERE a.ssot__AssetStatus__c = 'Active'
GROUP BY a.ssot__BillToAccountId__c
