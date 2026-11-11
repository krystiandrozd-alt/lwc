/**
 * DEMO ONLY. Returns the latest Customer_Insight__c record for an Account so the
 * accountData360Widget LWC can show admin-entered demo values. No Data Cloud involved.
 */
public with sharing class AccountData360WidgetController {
    @AuraEnabled(cacheable=true)
    public static Customer_Insight__c getInsight(Id recordId) {
        if (recordId == null) {
            return null;
        }
        List<Customer_Insight__c> rows = [
            SELECT
                Id, Churn_Score__c, Monthly_Revenue__c, Lifetime_Value__c, Active_Lines__c,
                Tenure_Months__c, Contract_End_Days__c, Network_Score__c, Payment_Score__c,
                Last_NPS__c, Open_Cases__c, Risk_Drivers__c, Retention_Offers__c, Usage_GB__c
            FROM Customer_Insight__c
            WHERE Account__c = :recordId
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }
}
