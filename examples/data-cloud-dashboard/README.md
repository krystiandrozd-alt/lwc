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

### MVNO KPI pack (inactive by default)

Seven extra records implement the D1 "Executive Subscriber Cockpit" from the _Data 360 Reference Configuration for a Small-to-Medium Mobile Operator / MVNO_. They ship with `Active__c = false`. Activate them once the DMOs and the insight they query exist in the org.

| Record                       | Type   | Source object                                  | Status of object/field names                             |
| ---------------------------- | ------ | ---------------------------------------------- | -------------------------------------------------------- |
| `MVNO_Active_Prepaid_Lines`  | Metric | `demo_MobileSubscriber__dlm`                   | Custom DMO from the reference config (inference)         |
| `MVNO_Active_Postpaid_Lines` | Metric | `demo_MobileSubscriber__dlm`                   | Custom DMO (inference)                                   |
| `MVNO_Gross_Adds_30d`        | Metric | `demo_MobileSubscriber__dlm.ActivationDate__c` | Custom DMO; field name is inference                      |
| `MVNO_Data_GB_Per_Line_30d`  | Metric | `demo_UsageDaily__dlm`                         | Custom DMO (inference)                                   |
| `MVNO_Dropped_Call_Rate_30d` | Metric | `ssot__NetworkUsage__dlm`                      | Standard DMO, fields confirmed in the DMO reference      |
| `MVNO_Churn_Risk_Bands`      | Table  | `CI_ChurnRisk__cio.churn_band__c`              | Calculated insight from the reference config (inference) |
| `MVNO_Lines_By_Payment_Type` | Table  | `demo_MobileSubscriber__dlm`                   | Custom DMO (inference)                                   |

Validate before a demo:

- Field values `ACTIVE`, `PRE`, `POST` and `DATA` must match what your ingestion transforms write.
- The date filter `CURRENT_DATE - INTERVAL '30' DAY` must run in your org's Data 360 SQL. Check it in Query Editor.
- A record whose DMO is missing shows an error on that tile only. The rest of the dashboard still loads.

## Demo widget for the Account page (no Data Cloud needed)

`accountData360Widget` ("Data 360 Customer Insights (Demo)") looks like a Data 360 widget but needs **no Data Cloud and no setup**. Use it for demos in orgs where Data 360 is not configured.

| Area              | Shows                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Churn risk        | Score 0–100, band badge (Low / Medium / High), meter, 6-month change                                                                                                   |
| KPIs              | Monthly revenue, lifetime value, lines, tenure, contract end, network score, payment score, last NPS, open cases (values outside thresholds are flagged in red with ▼) |
| Why at risk       | Driver bars whose points add up to the score                                                                                                                           |
| Usage             | Data-use sparkline (SVG, no chart library)                                                                                                                             |
| Retention actions | Up to 3 offers with acceptance %, expected value saved and a "Present offer" button (shows a toast only)                                                               |

Where the values come from, per Account:

1. **A Customer Insight (Demo) record** (`Customer_Insight__c`) linked to the Account. Each filled field is shown as typed.
2. **Generated values** for every blank field, or when the Account has no record. They are derived from the record ID, so the same Account always shows the same numbers. The _Risk scenario_ property (auto / high / medium / low) forces a band.

Text formats on the record:

| Field                     | Format                                                                                   | Example                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Risk Drivers              | one per line, `Label \| points`                                                          | `Contract ends within 60 days \| 15`                                 |
| Retention Offers          | one per line, `Name \| reason \| acceptance % \| cost`; first 3 shown in the order typed | `Re-contract 24 months, 20% off \| Contract ends soon \| 34 \| 1150` |
| Data Usage 12 Months (GB) | comma-separated, oldest first                                                            | `41,44,39,46,43,45,52,58,44,33,29,27`                                |

If _Churn Score_ is blank, the score is the sum of the driver points.

Set it up:

```bash
sf project deploy start --source-dir force-app/main/default/lwc/accountData360Widget --source-dir force-app/main/default/objects/Customer_Insight__c --source-dir force-app/main/default/classes/AccountData360WidgetController.cls --source-dir force-app/main/default/classes/AccountData360WidgetControllerTest.cls --source-dir force-app/main/default/tabs --source-dir force-app/main/default/permissionsets/Data_360_Demo_Widget.permissionset-meta.xml --target-org <alias>
```

```bash
sf org assign permset --name Data_360_Demo_Widget --target-org <alias>
```

Then open any Account, **Edit Page**, drag **Data 360 Customer Insights (Demo)** into the right-hand column, save and activate. To control the numbers, open the **Customer Insights (Demo)** tab, create a record and pick the Account.

The widget always shows a "Demo data" badge unless _Hide demo badge_ is ticked. Keep it on in client demos so nobody mistakes the numbers for real data.

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
