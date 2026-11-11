/**
 * Backend for the dataCloudDashboard LWC.
 *
 * - KPI tiles and tables: admin-defined Data 360 SQL stored in DC_Dashboard_Kpi__mdt,
 *   executed with the sfsqlquery namespace (recommended by Salesforce for new development).
 * - Segments: ConnectApi.CdpSegment.getSegmentsPaginated.
 *
 * All calls run in the running user's context, so Data 360 permissions still apply.
 */
public with sharing class DataCloudDashboardController {
    @TestVisible
    private static final Integer MAX_ROWS = 200;
    @TestVisible
    private static final Integer MAX_SEGMENTS = 200; // Connect API batchSize upper bound
    private static final String DEFAULT_DATASPACE = 'default';
    private static final String WORKLOAD_NAME = 'dataCloudDashboard';

    /** Test seam: segments come from ConnectApi, which cannot be mocked directly. */
    @TestVisible
    private static SegmentSource segmentSource = new ConnectApiSegmentSource();
    /** Test seam: custom metadata records cannot be inserted in tests. */
    @TestVisible
    private static List<DC_Dashboard_Kpi__mdt> kpiRecordsOverride;

    // ---------------------------------------------------------------- DTOs

    public class KpiDefinition {
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String displayType;
        @AuraEnabled
        public Integer sortOrder;
    }

    public class KpiResult {
        @AuraEnabled
        public String name;
        @AuraEnabled
        public List<String> columns = new List<String>();
        @AuraEnabled
        public List<Map<String, Object>> rows = new List<Map<String, Object>>();
        @AuraEnabled
        public Boolean truncated = false;
        @AuraEnabled
        public String queryId;
    }

    public class SegmentInfo {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String apiName;
        @AuraEnabled
        public String displayName;
        @AuraEnabled
        public String description;
        @AuraEnabled
        public String segmentType;
        @AuraEnabled
        public String segmentStatus;
        @AuraEnabled
        public String publishStatus;
        @AuraEnabled
        public String publishInterval;
        @AuraEnabled
        public String nextPublishDateTime;
        @AuraEnabled
        public String segmentOnApiName;
        @AuraEnabled
        public String dataSpace;
    }

    public interface SegmentSource {
        List<SegmentInfo> fetch(Integer batchSize, Integer offset, String orderBy, String dataspace);
    }

    // ---------------------------------------------------------------- API

    @AuraEnabled(cacheable=true)
    public static List<KpiDefinition> getKpiDefinitions() {
        List<KpiDefinition> result = new List<KpiDefinition>();
        for (DC_Dashboard_Kpi__mdt rec : loadKpiRecords()) {
            if (rec.Active__c != true) {
                continue;
            }
            KpiDefinition def = new KpiDefinition();
            def.name = rec.DeveloperName;
            def.label = rec.MasterLabel;
            def.displayType = String.isBlank(rec.Display_Type__c) ? 'Metric' : rec.Display_Type__c;
            def.sortOrder = rec.Sort_Order__c == null ? 0 : rec.Sort_Order__c.intValue();
            result.add(def);
        }
        result.sort(new KpiComparator());
        return result;
    }

    /**
     * Runs one KPI query. The client sends only the KPI DeveloperName, never SQL,
     * so users cannot run arbitrary statements through this controller.
     */
    @AuraEnabled
    public static KpiResult runKpi(String kpiName, String dataspace) {
        DC_Dashboard_Kpi__mdt rec = findKpi(kpiName);
        String sql = rec.Query__c == null ? '' : rec.Query__c.trim();
        if (!isReadOnlyQuery(sql)) {
            throw newAuraError('KPI "' + kpiName + '" must contain a SELECT or WITH query.');
        }
        try {
            return execute(rec.DeveloperName, sql, resolveDataspace(dataspace));
        } catch (Exception e) {
            throw newAuraError('Query for KPI "' + rec.MasterLabel + '" failed: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static List<SegmentInfo> getSegments(Integer batchSize, Integer offset, String dataspace) {
        Integer size = (batchSize == null || batchSize < 1) ? 50 : Math.min(batchSize, MAX_SEGMENTS);
        Integer skip = (offset == null || offset < 0) ? 0 : offset;
        try {
            return segmentSource.fetch(size, skip, null, resolveDataspace(dataspace));
        } catch (Exception e) {
            throw newAuraError('Could not load segments: ' + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- internals

    @TestVisible
    private static KpiResult execute(String name, String sql, String dataspace) {
        sfsqlquery.SqlRowIterator it = sfsqlquery.SqlStatement.create(sql, dataspace)
            .withWorkloadName(WORKLOAD_NAME)
            .execute();

        KpiResult result = new KpiResult();
        result.name = name;
        result.queryId = it.getQueryId();
        List<String> columns = it.getColumnNames();
        result.columns = columns == null ? new List<String>() : columns;

        while (it.hasNext()) {
            if (result.rows.size() >= MAX_ROWS) {
                result.truncated = true;
                it.cancel();
                break;
            }
            sfsqlquery.Row row = it.next();
            Map<String, Object> values = new Map<String, Object>();
            for (Integer i = 0; i < result.columns.size(); i++) {
                values.put(result.columns[i], row.getObject(i));
            }
            result.rows.add(values);
        }
        return result;
    }

    @TestVisible
    private static Boolean isReadOnlyQuery(String sql) {
        if (String.isBlank(sql)) {
            return false;
        }
        String head = sql.trim().toUpperCase();
        // Allow leading SQL line comments.
        while (head.startsWith('--')) {
            Integer nl = head.indexOf('\n');
            if (nl < 0) {
                return false;
            }
            head = head.substring(nl + 1).trim();
        }
        return head.startsWith('SELECT') || head.startsWith('WITH');
    }

    private static String resolveDataspace(String dataspace) {
        return String.isBlank(dataspace) ? DEFAULT_DATASPACE : dataspace.trim();
    }

    private static List<DC_Dashboard_Kpi__mdt> loadKpiRecords() {
        if (kpiRecordsOverride != null) {
            return kpiRecordsOverride;
        }
        return DC_Dashboard_Kpi__mdt.getAll().values();
    }

    private static DC_Dashboard_Kpi__mdt findKpi(String kpiName) {
        if (String.isNotBlank(kpiName)) {
            for (DC_Dashboard_Kpi__mdt rec : loadKpiRecords()) {
                if (rec.DeveloperName == kpiName && rec.Active__c == true) {
                    return rec;
                }
            }
        }
        throw newAuraError('Unknown or inactive KPI: ' + kpiName);
    }

    private static AuraHandledException newAuraError(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message); // keeps the message readable in Apex tests
        return e;
    }

    private class KpiComparator implements Comparator<KpiDefinition> {
        public Integer compare(KpiDefinition a, KpiDefinition b) {
            if (a.sortOrder != b.sortOrder) {
                return a.sortOrder < b.sortOrder ? -1 : 1;
            }
            return a.label.compareTo(b.label);
        }
    }

    @TestVisible
    private class ConnectApiSegmentSource implements SegmentSource {
        public List<SegmentInfo> fetch(Integer batchSize, Integer offset, String orderBy, String dataspace) {
            ConnectApi.CdpSegmentContainerOutput container = ConnectApi.CdpSegment.getSegmentsPaginated(
                batchSize,
                offset,
                orderBy,
                dataspace
            );
            List<SegmentInfo> result = new List<SegmentInfo>();
            if (container == null || container.segments == null) {
                return result;
            }
            for (ConnectApi.CdpSegmentOutput s : container.segments) {
                result.add(toInfo(s));
            }
            return result;
        }
    }

    @TestVisible
    private static SegmentInfo toInfo(ConnectApi.CdpSegmentOutput s) {
        SegmentInfo info = new SegmentInfo();
        info.id = s.marketSegmentId;
        info.apiName = s.apiName;
        info.displayName = String.isNotBlank(s.displayName) ? s.displayName : s.developerName;
        info.description = s.description;
        info.segmentType = s.segmentType;
        info.segmentStatus = s.segmentStatus;
        info.publishStatus = s.publishStatus;
        info.publishInterval = s.publishInterval;
        info.nextPublishDateTime = s.nextPublishDateTime;
        info.segmentOnApiName = s.segmentOnApiName;
        info.dataSpace = s.dataSpace;
        return info;
    }
}
