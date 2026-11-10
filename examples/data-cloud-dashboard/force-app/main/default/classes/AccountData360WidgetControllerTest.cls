@IsTest
private class AccountData360WidgetControllerTest {
    @IsTest
    static void returnsLatestInsightOrNull() {
        Account acc = new Account(Name = 'Demo Household');
        insert acc;
        Assert.isNull(AccountData360WidgetController.getInsight(acc.Id));
        Assert.isNull(AccountData360WidgetController.getInsight(null));

        insert new Customer_Insight__c(Account__c = acc.Id, Churn_Score__c = 72, Usage_GB__c = '40,38,30');
        Customer_Insight__c got = AccountData360WidgetController.getInsight(acc.Id);
        Assert.areEqual(72, got.Churn_Score__c);
        Assert.areEqual('40,38,30', got.Usage_GB__c);
    }
}
