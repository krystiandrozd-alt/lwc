-- du_CI_UsageTrend: data GB in the last 30 days vs the 60 days before (average per 30 days)
SELECT
    u.account_id__c                                                                         AS account_id__c,
    SUM(CASE WHEN u.service_type__c = 'DATA' AND u.usage_date__c >  date_add(current_date(), -30)
             THEN u.volume_mb__c ELSE 0 END) / 1024                                         AS data_gb_m0__c,
    SUM(CASE WHEN u.service_type__c = 'DATA' AND u.usage_date__c <= date_add(current_date(), -30)
             THEN u.volume_mb__c ELSE 0 END) / 2048                                         AS data_gb_prev_avg__c,
    SUM(CASE WHEN u.service_type__c = 'VOICE' AND u.usage_date__c > date_add(current_date(), -30)
             THEN u.duration_min__c ELSE 0 END)                                             AS voice_min_m0__c,
    SUM(CASE WHEN u.service_type__c = 'ROAM_DATA' THEN u.rated_amount_aed__c ELSE 0 END)    AS roaming_aed_90d__c
FROM du_UsageDaily__dlm u
WHERE u.usage_date__c > date_add(current_date(), -90)
GROUP BY u.account_id__c
