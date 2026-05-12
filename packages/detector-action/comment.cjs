function formatDetectorComment(result) {
  const rows =
    Array.isArray(result.issues) && result.issues.length > 0
      ? result.issues
          .map((issue) => `| ${issue.line} | ${issue.failureMode} | ${issue.description} |`)
          .join('\n')
      : '| - | - | No suspect lines. |';

  return `## dispatch.ai detector

Verdict: **${result.verdict}**
Score: **${result.score}**

| Line | Mode | Issue |
|---:|---:|---|
${rows}`;
}

module.exports = { formatDetectorComment };
