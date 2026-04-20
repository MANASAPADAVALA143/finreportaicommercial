## Variance Analysis Skill

When asked to perform variance analysis:

1. Ask the user to share their Budget vs Actual Excel file.
2. Call the FinReportAI API at the MCP endpoint (or POST `/excel/analyze?analysis_type=variance` with multipart file field `file`).
3. Return a structured variance report with:
   - Executive summary
   - Top variances explained
   - Risk flags
   - Recommended actions
4. Format output as a professional finance report.

Always express variances as both absolute values and percentages. Flag anything over 10% variance as requiring explanation. Use Indian accounting context (INR, Ind AS standards) unless the client specifies otherwise.
