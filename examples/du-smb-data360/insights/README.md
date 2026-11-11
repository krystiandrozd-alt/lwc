# Calculated insights (draft SQL)

Structure follows the documented calculated-insight pattern: `SELECT <dimensions>, <aggregations> FROM <DMO> [JOIN ...] [WHERE ...] GROUP BY <dimensions>`, with at least one measure.
Every insight has **one dimension, the Account ID**, so it can also feed copy-field enrichments on the CRM Account.

[VALIDATE] before go-live, in the org's insight builder:

- custom DMO field API names (assumed `<dlo_field>__c`, for example `account_id__c`)
- date functions used for the rolling windows (`current_date()`, `date_add`)

If the date functions are rejected, fall back to fixed dates: the generator anchors all data to its run date (`--as-of`).

| File                        | Insight                 | Measures                                        |
| --------------------------- | ----------------------- | ----------------------------------------------- |
| `ci_account_value.sql`      | du_CI_AccountValue      | active lines, MRC, 5G-ready lines               |
| `ci_usage_trend.sql`        | du_CI_UsageTrend        | data GB last 30 days vs previous 60 days        |
| `ci_network_experience.sql` | du_CI_NetworkExperience | avg call drop, setup success, throughput        |
| `ci_service_payment.sql`    | du_CI_ServicePayment    | tickets and SLA breaches 90 days, avg days late |
| `ci_churn_risk.sql`         | du_CI_ChurnRisk         | latest ingested churn score and next best offer |

Why the churn score is ingested, not computed in SQL: CI-on-CI chaining and multi-DMO scoring are the most fragile part for a demo org. The generator writes a model-style score (`AccountRiskSnapshot`) whose drivers are consistent with the usage, network, service and billing data. The demo story is "a scoring job (AI Models or external) writes the score back to Data 360".
