import * as JSZip from "jszip";

class LRUCache<K, V> {
  private maxSize: number;
  private cache = new Map<K, V>();
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  get(key: K): V | undefined {
    const val = this.cache.get(key);
    if (!val) return undefined;
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      // @ts-expect-error we don't care
      this.cache.delete(oldestKey);
    }
  }
  clear(): void {
    this.cache.clear();
  }
}

const zipCache = new LRUCache<string, JSZip>(200);
const artifactCache = new LRUCache<string, { url: string }[]>(200);

interface Config {
  sentryAuthToken: string | null;
  projectConfigs: ProjectConfig[];
}

interface ProjectConfig {
  project: string;
  projectName: string;
  organization: string;
  organizationName: string;
  urlPattern: string;
}

let config: Config = {
  sentryAuthToken: null,
  projectConfigs: [],
};

// Load the configuration when DevTools are opened
function loadConfig(): Promise<Config> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sentryAuthToken", "projectConfigs"], (result) => {
      config = {
        sentryAuthToken: result.sentryAuthToken || null,
        projectConfigs: result.projectConfigs || [],
      };
      resolve(config);
    });
  });
}

// Listen for changes to the stored configuration
chrome.storage.onChanged.addListener((changes) => {
  if (changes.sentryAuthToken) {
    config.sentryAuthToken = changes.sentryAuthToken.newValue;
  }

  if (changes.projectConfigs) {
    config.projectConfigs = changes.projectConfigs.newValue || [];
  }
});

// Check if the current URL matches any project configurations
function findMatchingConfigs(url: string): ProjectConfig[] {
  const matches = config.projectConfigs.filter((pc) => {
    try {
      const regexPattern = pc.urlPattern.replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      const isMatch = regex.test(url);
      return isMatch;
    } catch {
      return false;
    }
  });
  return matches;
}

// Initialize configuration when script loads
loadConfig();

async function processResource(
  resource: chrome.devtools.inspectedWindow.Resource
) {
  const tab = await chrome.tabs.get(chrome.devtools.inspectedWindow.tabId);

  if (!tab || !tab.url) {
    return;
  }

  const currentConfig = await loadConfig();
  if (!currentConfig.sentryAuthToken) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((resource as any).type !== "script") {
    return;
  }

  const matchingConfigs = findMatchingConfigs(tab.url);

  if (matchingConfigs.length === 0) {
    return;
  }

  const resourceBuildId =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resource as any).buildId ??
    (await new Promise((resolve) => {
      resource.getContent((content, encoding) => {
        if (!content) {
          return resolve(undefined);
        }

        const decodedContent = encoding ? atob(content) : content;

        const sentryMagicExpression = decodedContent.match(
          /sentry-dbid-([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/
        );

        if (sentryMagicExpression) {
          return resolve(sentryMagicExpression[1]);
        }

        const debugIdMagicComment = decodedContent.match(
          /^\s*\/\/#\s?debugId=(.*)$/m
        );

        if (debugIdMagicComment) {
          return resolve(debugIdMagicComment[1]);
        }

        return resolve(undefined);
      });
    }));

  if (!resourceBuildId) {
    return;
  }

  try {
    const { organization: orgSlug, project: projectSlug } = matchingConfigs[0];

    const headers = {
      Authorization: `Bearer ${currentConfig.sentryAuthToken}`,
    };

    const lookupUrl = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/artifact-lookup/?debug_id=${resourceBuildId}`;

    const cacheKeyLookup = lookupUrl.toString();
    let artifactBundlesWithDebugID = artifactCache.get(cacheKeyLookup);
    if (!artifactBundlesWithDebugID) {
      const artifactLookupResponse = await fetch(lookupUrl, { headers });
      artifactBundlesWithDebugID = (await artifactLookupResponse.json()) as {
        url: string;
      }[];
      artifactCache.set(cacheKeyLookup, artifactBundlesWithDebugID);
    }

    const bundleInfo = artifactBundlesWithDebugID[0];
    if (!bundleInfo) {
      return;
    }

    const zipUrl = new URL(bundleInfo.url);
    zipUrl.hostname = "sentry.io";
    zipUrl.protocol = "https:";
    zipUrl.port = "";

    const cacheKey = zipUrl.toString();
    let zip = zipCache.get(cacheKey);
    if (!zip) {
      const zipFileResponse = await fetch(zipUrl.toString(), { headers });
      const zipBlob = await zipFileResponse.blob();
      zip = await JSZip.loadAsync(zipBlob);
      zipCache.set(cacheKey, zip);
    }

    const manifestStringContent = await zip
      .file("manifest.json")
      ?.async("string");
    if (!manifestStringContent) {
      return;
    }

    let manifest: {
      files: Record<string, { type: string; headers: { "debug-id": string } }>;
    };
    try {
      manifest = JSON.parse(manifestStringContent);
    } catch (err) {
      console.error("[JSZip] Failed to parse manifest.json:", err);
      return;
    }

    const zipPathForSourcemap = Object.entries(manifest.files).find(
      ([, info]) =>
        info.type === "source_map" &&
        info.headers["debug-id"] === resourceBuildId
    )?.[0];

    if (!zipPathForSourcemap) {
      return;
    }

    const sourceMapStringContent = await zip
      .file(zipPathForSourcemap)
      ?.async("string");
    if (!sourceMapStringContent) {
      return;
    }

    const base64SourceMap = btoa(
      unescape(encodeURIComponent(sourceMapStringContent))
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resource as any).attachSourceMapURL(
      `data:application/json;base64,${base64SourceMap}`
    );
  } catch (err) {
    console.error("[processResource] Error in source map flow:", err);
  }
}

chrome.devtools.inspectedWindow.getResources((resources) => {
  resources.forEach(processResource);
});

chrome.devtools.inspectedWindow.onResourceAdded.addListener(processResource);

window.addEventListener("unload", () => {
  zipCache.clear();
  artifactCache.clear();
});
