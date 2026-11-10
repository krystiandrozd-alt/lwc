@IsTest
private class DataCloudDashboardControllerTest {
    private static DC_Dashboard_Kpi__mdt kpi(String name, String type, String sql, Integer sortOrder, Boolean active) {
        DC_Dashboard_Kpi__mdt rec = new DC_Dashboard_Kpi__mdt();
        rec.DeveloperName = name;
        rec.MasterLabel = name.replace('_', ' ');
        rec.Display_Type__c = type;
        rec.Query__c = sql;
        rec.Sort_Order__c = sortOrder;
        rec.Active__c = active;
        return rec;
    }

    private static void mockSql(List<String> columnNames, List<List<Object>> data) {
        sfsqlquery.SqlTester.clearMocks();
        List<ConnectApi.QuerySqlMetadataItem> meta = new List<ConnectApi.QuerySqlMetadataItem>();
        for (String c : columnNames) {
            ConnectApi.QuerySqlMetadataItem col = new ConnectApi.QuerySqlMetadataItem();
            col.name = c;
            col.type = ConnectApi.TypeEnum.VARCHAR;
            meta.add(col);
        }
        sfsqlquery.SqlTester.setMockMetadata(meta);
        List<ConnectApi.QuerySqlRow> rows = new List<ConnectApi.QuerySqlRow>();
        for (List<Object> values : data) {
            ConnectApi.QuerySqlRow r = new ConnectApi.QuerySqlRow();
            r.rowData = values;
            rows.add(r);
        }
        sfsqlquery.SqlTester.setMockRows(rows);
    }

    private class FakeSegments implements DataCloudDashboardController.SegmentSource {
        public Integer lastBatchSize;
        public String lastDataspace;
        public Boolean fail = false;
        public List<DataCloudDashboardController.SegmentInfo> fetch(
            Integer batchSize,
            Integer offset,
            String orderBy,
            String dataspace
        ) {
            if (fail) {
                throw new CalloutException('boom');
            }
            lastBatchSize = batchSize;
            lastDataspace = dataspace;
            DataCloudDashboardController.SegmentInfo s = new DataCloudDashboardController.SegmentInfo();
            s.apiName = 'High_Value_B2B';
            s.publishStatus = 'SUCCESS';
            return new List<DataCloudDashboardController.SegmentInfo>{ s };
        }
    }

    @IsTest
    static void definitionsAreFilteredAndSorted() {
        DataCloudDashboardController.kpiRecordsOverride = new List<DC_Dashboard_Kpi__mdt>{
            kpi('B_Table', 'Table', 'SELECT 1', 20, true),
            kpi('A_Metric', 'Metric', 'SELECT 1', 10, true),
            kpi('Hidden', 'Metric', 'SELECT 1', 1, false)
        };
        List<DataCloudDashboardController.KpiDefinition> defs = DataCloudDashboardController.getKpiDefinitions();
        Assert.areEqual(2, defs.size());
        Assert.areEqual('A_Metric', defs[0].name);
        Assert.areEqual('Table', defs[1].displayType);
    }

    @IsTest
    static void runKpiReturnsRows() {
        DataCloudDashboardController.kpiRecordsOverride = new List<DC_Dashboard_Kpi__mdt>{
            kpi('Total', 'Metric', 'SELECT COUNT(*) AS total FROM ssot__Individual__dlm', 1, true)
        };
        mockSql(new List<String>{ 'total' }, new List<List<Object>>{ new List<Object>{ 42 } });

        DataCloudDashboardController.KpiResult res = DataCloudDashboardController.runKpi('Total', null);
        Assert.areEqual(new List<String>{ 'total' }, res.columns);
        Assert.areEqual(1, res.rows.size());
        Assert.areEqual(42, res.rows[0].get('total'));
        Assert.isFalse(res.truncated);
    }

    @IsTest
    static void runKpiRejectsUnknownAndNonSelect() {
        DataCloudDashboardController.kpiRecordsOverride = new List<DC_Dashboard_Kpi__mdt>{
            kpi('Bad', 'Metric', 'DELETE FROM x', 1, true)
        };
        try {
            DataCloudDashboardController.runKpi('Nope', null);
            Assert.fail('expected exception');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('Unknown'));
        }
        try {
            DataCloudDashboardController.runKpi('Bad', null);
            Assert.fail('expected exception');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('SELECT'));
        }
    }

    @IsTest
    static void readOnlyCheck() {
        Assert.isTrue(DataCloudDashboardController.isReadOnlyQuery('  select 1'));
        Assert.isTrue(DataCloudDashboardController.isReadOnlyQuery('-- note\nWITH a AS (SELECT 1) SELECT * FROM a'));
        Assert.isFalse(DataCloudDashboardController.isReadOnlyQuery('UPDATE x SET y = 1'));
        Assert.isFalse(DataCloudDashboardController.isReadOnlyQuery(''));
        Assert.isFalse(DataCloudDashboardController.isReadOnlyQuery('-- only a comment'));
    }

    @IsTest
    static void segmentsUseDefaultsAndClampBatchSize() {
        FakeSegments fake = new FakeSegments();
        DataCloudDashboardController.segmentSource = fake;
        List<DataCloudDashboardController.SegmentInfo> segs = DataCloudDashboardController.getSegments(5000, -1, '');
        Assert.areEqual(1, segs.size());
        Assert.areEqual(DataCloudDashboardController.MAX_SEGMENTS, fake.lastBatchSize);
        Assert.areEqual('default', fake.lastDataspace);
    }

    @IsTest
    static void segmentErrorsAreWrapped() {
        FakeSegments fake = new FakeSegments();
        fake.fail = true;
        DataCloudDashboardController.segmentSource = fake;
        try {
            DataCloudDashboardController.getSegments(10, 0, 'default');
            Assert.fail('expected exception');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('boom'));
        }
    }
}
