# Data 360 (Data Cloud) Dashboard – LWC

A standalone SFDX project with a Lightning Web Component that shows:

1. **DMO / query KPIs**: metric tiles and tables built from Data 360 SQL. The queries are defined by admins in custom metadata.
2. **Segments and publishing**: segment list with status, publish status, interval and next publish time, plus a summary row.

This folder is separate from the LWC framework packages in this repository. It has its own `package.json` and is excluded from the root ESLint config.

## Architecture

| Layer       | Component                                                         | Data 360 API used                                                                   |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| UI          | `lwc/dataCloudDashboard`                                          | —                                                                                   |
| KPI config  | `DC_Dashboard_Kpi__mdt` (Query, Display Type, Sort Order, Active) | —                                                                                   |
| KPI queries | `DataCloudDashboardController.runKpi`                             | `sfsqlquery.SqlStatement` → `SqlRowIterator` → `Row`                                |
| Segments    | `DataCloudDashboardController.getSegments`                        | `ConnectApi.CdpSegment.getSegmentsPaginated(batchSize, offset, orderBy, dataspace)` |
| Access      | `Data_Cloud_Dashboard` permission set                             | Apex class + CMDT access only                                                       |

Design choices:

- **The client never sends SQL.** It sends only the KPI's DeveloperName. Apex looks up the query in custom metadata and accepts only statements that start with `SELECT` or `WITH`.
- **Each KPI loads on its own.** If one query fails (for example, no access to a DMO), only that tile shows an error.
- **Row cap:** 200 rows per table KPI. Above that, the query is cancelled and the table is marked as truncated.
- **User context:** everything runs `with sharing` as the current user, so Data 360 permissions apply.

## Configure KPIs

Add records to **DC Dashboard KPI** (Setup → Custom Metadata Types). Two samples are included:

| Record               | Type   | Query                                                                              |
| -------------------- | ------ | ---------------------------------------------------------------------------------- |
| `Total_Individuals`  | Metric | `SELECT COUNT(*) AS total FROM ssot__Individual__dlm`                              |
| `Sample_Individuals` | Table  | `SELECT ssot__FirstName__c, ssot__LastName__c FROM ssot__Individual__dlm LIMIT 10` |

A **Metric** tile shows the first column of the first row. A **Table** renders all returned columns.

## Component properties (App Builder)

| Property                 | Default            | Notes                                                                                                       |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Title                    | Data 360 Dashboard | Card title                                                                                                  |
| Data space (`spaceName`) | `default`          | Data 360 data space API name. LWC reserves public property names that start with `data`, hence `spaceName`. |
| Segments to load         | 50                 | 1–200 (Connect API batch limit)                                                                             |
| Hide segments section    | false              |                                                                                                             |

## Deploy

```bash
sf project deploy start --source-dir force-app --target-org <alias>
```

```bash
sf apex run test --class-names DataCloudDashboardControllerTest --target-org <alias> --result-format human
```

```bash
sf org assign permset --name Data_Cloud_Dashboard --target-org <alias>
```

Users also need a Data 360 permission set (for example, Data Cloud User) that gives access to the DMOs being queried and to segments.

## Jest tests

```bash
yarn install
```

```bash
yarn test
```

## Known limitations and assumptions

- **API version 68.0.** The project targets the Winter '27 Apex reference, which is where `sfsqlquery` is documented. If your org is on an older release, use `ConnectApi.CdpQuery.queryAnsiSqlV2` instead.
- **No segment population counts.** `ConnectApi.CdpSegmentOutput` does not include member counts. To add one, create a Metric KPI that counts rows in the segment's membership DMO (`segmentMembershipTable` on the segment output).
- **No activation targets.** This version shows segment publish status only. It does not list activation targets per segment.
- **Status colors are a heuristic.** `segmentStatus` and `publishStatus` are free-text strings in the API. Values containing `ERROR`/`FAIL` show red. Values containing `ACTIVE`/`SUCCESS`/`PUBLISHED`/`COMPLETED` show green.

## References

- [Query Data 360 Data with Apex](https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/dc-apex-query.md)
- [sfsqlquery namespace](https://developer.salesforce.com/docs/platform/apex-ref/references/apex-ref/apex-namespace-sfsqlquery.md)
- [ConnectApi.CdpSegment methods](https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ConnectAPI_CdpSegment_static_methods.htm)
- [ConnectApi.CdpSegmentOutput](https://developer.salesforce.com/docs/platform/apex-ref/references/apex-ref/apex-connectapi-output-cdp-segment-output.md)
- [Data 360 llms.txt](https://developer.salesforce.com/docs/llms-data-cloud.txt)
