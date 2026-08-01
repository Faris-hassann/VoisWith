import type { Locator } from "playwright";
import type { TestingType } from "../testing/test-types.js";
import type {
  ConsoleObservation,
  NetworkObservation,
  PerformanceObservation,
} from "./report.js";

export interface Credentials {
  loginUrl?: string;
  username: string;
  password: string;
  fieldHints?: {
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  };
}

export interface TestingRunRequest {
  targetUrl: string;
  authorizationConfirmed: boolean;
  credentials?: Credentials;
  testTypes: TestingType[];
  crawl: {
    strategy: "DFS";
    maxDepth: number;
    maxPages: number;
    sameOriginOnly: boolean;
    includePatterns: string[];
    excludePatterns: string[];
  };
  browser: {
    channel: "chrome";
    headless: boolean;
    viewport: {
      width: number;
      height: number;
    };
  };
  execution: {
    safeMode: boolean;
    allowFormSubmission: boolean;
    allowFileUploads: boolean;
    allowDestructiveActions: boolean;
    allowPayments: boolean;
    maximumActionsPerPage: number;
    maximumRunDurationSeconds: number;
  };
}

export interface PageSnapshot {
  url: string;
  canonicalUrl: string;
  title: string;
  headings: string[];
  visibleText: string;
  links: LinkSnapshot[];
  elements: ElementInventoryItem[];
  forms: FormSnapshot[];
  tables: string[];
  dialogs: ElementInventoryItem[];
  currentQueryParameters: Record<string, string>;
  consoleErrors: ConsoleObservation[];
  failedRequests: NetworkObservation[];
  observedApiCalls: NetworkObservation[];
  performance: PerformanceObservation[];
  visibleValidationErrors: string[];
}

export interface LinkSnapshot {
  text: string;
  href: string;
  canonicalHref?: string;
  internal: boolean;
  sourceElementId?: string;
}

export interface FormSnapshot {
  elementId: string;
  method?: string;
  action?: string;
  fields: ElementInventoryItem[];
  submitControls: ElementInventoryItem[];
  apparentPurpose?: string;
}

export interface ElementInventoryItem {
  id: string;
  kind:
    | "link"
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio"
    | "file"
    | "form"
    | "dialog"
    | "tab"
    | "menu"
    | "pagination"
    | "search"
    | "submit"
    | "other";
  tagName: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  value?: string;
  disabled: boolean;
  hidden: boolean;
  required?: boolean;
  validation?: Record<string, string | number | boolean>;
  formAction?: string;
  formMethod?: string;
  locator: LocatorDescriptor;
}

export interface LocatorDescriptor {
  strategy: "role" | "label" | "placeholder" | "testId" | "name" | "css";
  value: string;
  role?: string;
  exact?: boolean;
}

export interface ResolvedElement {
  item: ElementInventoryItem;
  locator: Locator;
}
