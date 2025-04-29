import * as JSZip from "jszip";

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

// Listen for resources being added to the page
chrome.devtools.inspectedWindow.onResourceAdded.addListener(
  async (resource) => {
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
      ((resource as any).buildId as string | undefined) ??
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
      const { organization: orgSlug, project: projectSlug } =
        matchingConfigs[0];

      const headers = {
        Authorization: `Bearer ${currentConfig.sentryAuthToken}`,
      };

      const lookupUrl = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/artifact-lookup/?debug_id=${resourceBuildId}`;

      const artifactLookupResponse = await fetch(lookupUrl, { headers });

      const artifactBundlesWithDebugID =
        (await artifactLookupResponse.json()) as {
          url: string;
        }[];

      const bundleInfo = artifactBundlesWithDebugID[0];
      if (!bundleInfo) {
        return;
      }

      const zipUrl = new URL(bundleInfo.url);
      zipUrl.hostname = "sentry.io";
      zipUrl.protocol = "https:";
      zipUrl.port = "";

      const zipFileResponse = await fetch(zipUrl.toString(), { headers });
      const zipBlob = await zipFileResponse.blob();

      const zip = await JSZip.loadAsync(zipBlob);

      const manifestStringContent = await zip
        .file("manifest.json")
        ?.async("string");
      if (!manifestStringContent) {
        return;
      }

      let manifest: {
        files: Record<
          string,
          { type: string; headers: { "debug-id": string } }
        >;
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

      // This looks abysmal but not doing the encode unescape dance results in errors where certain characters are out of base64 range
      const base64SourceMap = btoa(
        unescape(encodeURIComponent(sourceMapStringContent))
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resource as any).attachSourceMapURL(
        `data:application/json;base64,${base64SourceMap}`
      );
    } catch (err) {
      console.error("[onResourceAdded] Error in source map flow:", err);
    }
  }
);
