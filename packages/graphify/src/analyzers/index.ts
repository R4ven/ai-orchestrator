export * from "./base.js";
export * from "./javascriptAnalyzer.js";
export * from "./pythonAnalyzer.js";
export * from "./phpAnalyzer.js";
export * from "./configAnalyzer.js";
export * from "./docAnalyzer.js";

import { JavaScriptAnalyzer } from "./javascriptAnalyzer.js";
import { PythonAnalyzer } from "./pythonAnalyzer.js";
import { PhpAnalyzer } from "./phpAnalyzer.js";
import { ConfigAnalyzer } from "./configAnalyzer.js";
import { DocAnalyzer } from "./docAnalyzer.js";
import type { Analyzer } from "./base.js";

/** Default analyzer set, tried in order; the scanner uses the first one whose `supports()` matches. */
export function defaultAnalyzers(): Analyzer[] {
  return [new JavaScriptAnalyzer(), new PythonAnalyzer(), new PhpAnalyzer(), new ConfigAnalyzer(), new DocAnalyzer()];
}
