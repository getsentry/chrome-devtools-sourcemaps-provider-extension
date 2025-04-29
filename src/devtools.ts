import * as JSZip from "jszip";

// DevTools script for Sentry Sourcemap Provider

// Store configurations
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
  console.log(
    "[loadConfig] Starting to load config from chrome.storage.sync..."
  );
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sentryAuthToken", "projectConfigs"], (result) => {
      config = {
        sentryAuthToken: result.sentryAuthToken || null,
        projectConfigs: result.projectConfigs || [],
      };
      console.log("[loadConfig] Loaded config:", {
        sentryAuthToken: config.sentryAuthToken ? "✔️ present" : "❌ none",
        projectConfigsCount: config.projectConfigs.length,
      });
      resolve(config);
    });
  });
}

// Listen for changes to the stored configuration
chrome.storage.onChanged.addListener((changes) => {
  console.log("[storage.onChanged] Change detected:", changes);

  if (changes.sentryAuthToken) {
    config.sentryAuthToken = changes.sentryAuthToken.newValue;
    console.log(
      "[storage.onChanged] sentryAuthToken updated:",
      config.sentryAuthToken ? "✔️ present" : "❌ removed"
    );
  }

  if (changes.projectConfigs) {
    config.projectConfigs = changes.projectConfigs.newValue || [];
    console.log(
      "[storage.onChanged] projectConfigs updated, new count:",
      config.projectConfigs.length
    );
  }
});

// Check if the current URL matches any project configurations
function findMatchingConfigs(url: string): ProjectConfig[] {
  console.log("[findMatchingConfigs] Matching URL:", url);
  const matches = config.projectConfigs.filter((pc) => {
    try {
      const regexPattern = pc.urlPattern.replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      const isMatch = regex.test(url);
      console.log(
        `[findMatchingConfigs] pattern=${pc.urlPattern} -> regex=${regex}, match=${isMatch}`
      );
      return isMatch;
    } catch (err) {
      console.error(
        "[findMatchingConfigs] Invalid pattern:",
        pc.urlPattern,
        err
      );
      return false;
    }
  });
  console.log("[findMatchingConfigs] Total matches found:", matches.length);
  return matches;
}

// Initialize configuration when script loads
loadConfig().then(() => {
  console.log("[init] DevTools extension initialized with config:", config);
});

// Listen for resources being added to the page
chrome.devtools.inspectedWindow.onResourceAdded.addListener(
  async (resource) => {
    const tab = await chrome.tabs.get(chrome.devtools.inspectedWindow.tabId);

    if (!tab || !tab.url) {
      console.log("[onResourceAdded] Tab not found");
      return;
    }

    console.log("[onResourceAdded] New resource detected:", resource);

    const currentConfig = await loadConfig();
    if (!currentConfig.sentryAuthToken) {
      console.log("[onResourceAdded] No auth token, skipping.");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((resource as any).type !== "script") {
      console.log("[onResourceAdded] Not a script, skipping.");
      return;
    }

    const matchingConfigs = findMatchingConfigs(tab.url);

    if (matchingConfigs.length === 0) {
      console.log("[onResourceAdded] No project config matches URL:", tab.url);
      return;
    }

    const url = resource.url;
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
      console.log(
        `[onResourceAdded] No buildId on resource "${url}", skipping lookup.`
      );
      return;
    }

    console.log(
      "[onResourceAdded] Proceeding to fetch source maps for:",
      matchingConfigs[0]
    );

    try {
      const { organization: orgSlug, project: projectSlug } =
        matchingConfigs[0];

      const headers = {
        Authorization: `Bearer ${currentConfig.sentryAuthToken}`,
      };

      const lookupUrl = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/artifact-lookup/?debug_id=${resourceBuildId}`;
      console.log("[fetch] Artifact lookup URL:", lookupUrl);

      const artifactLookupResponse = await fetch(lookupUrl, { headers });
      console.log(
        "[fetch] Artifact lookup status:",
        artifactLookupResponse.status
      );
      const artifactBundlesWithDebugID =
        (await artifactLookupResponse.json()) as {
          url: string;
        }[];
      console.log(
        "[fetch] Artifact lookup result count:",
        artifactBundlesWithDebugID.length
      );

      const bundleInfo = artifactBundlesWithDebugID[0];
      if (!bundleInfo) {
        console.log("[fetch] No artifact bundle returned, stopping.");
        return;
      }

      const zipUrl = new URL(bundleInfo.url);
      zipUrl.hostname = "sentry.io";
      zipUrl.protocol = "https:";
      zipUrl.port = "";

      console.log("[fetch] Fetching zip at:", zipUrl.toString());
      const zipFileResponse = await fetch(zipUrl.toString(), { headers });
      console.log("[fetch] Zip fetch status:", zipFileResponse.status);
      const zipBlob = await zipFileResponse.blob();
      console.log("[fetch] Zip blob size (bytes):", zipBlob.size);

      console.log("[JSZip] Loading zip...");
      const zip = await JSZip.loadAsync(zipBlob);
      console.log(
        "[JSZip] Number of files in zip:",
        Object.keys(zip.files).length
      );

      const manifestStringContent = await zip
        .file("manifest.json")
        ?.async("string");
      if (!manifestStringContent) {
        console.log("[JSZip] No manifest.json found, stopping.");
        return;
      }
      console.log(
        "[JSZip] manifest.json length (chars):",
        manifestStringContent.length
      );

      let manifest: {
        files: Record<
          string,
          { type: string; headers: { "debug-id": string } }
        >;
      };
      try {
        manifest = JSON.parse(manifestStringContent);
        console.log(
          "[JSZip] Parsed manifest.json, entries:",
          Object.keys(manifest.files).length
        );
      } catch (err) {
        console.error("[JSZip] Failed to parse manifest.json:", err);
        return;
      }

      const zipPathForSourcemap = Object.entries(manifest.files).find(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([path, info]) =>
          info.type === "source_map" &&
          info.headers["debug-id"] === resourceBuildId
      )?.[0];

      if (!zipPathForSourcemap) {
        console.log(
          "[JSZip] No matching source_map entry for debug-id",
          resourceBuildId
        );
        return;
      }
      console.log("[JSZip] Found source map path in zip:", zipPathForSourcemap);

      const sourceMapStringContent = await zip
        .file(zipPathForSourcemap)
        ?.async("string");
      if (!sourceMapStringContent) {
        console.log("[JSZip] Failed to read source map content, stopping.");
        return;
      }
      console.log(
        "[JSZip] Source map length (chars):",
        sourceMapStringContent.length
      );

      const base64 = btoa(sourceMapStringContent);
      const dataUrl = `data:application/json;base64,${base64}`;
      console.log("[attachSourceMapURL] Attaching source map for", url, {
        dataUrl,
        sourceMapStringContent,
      });
      (resource as any).attachSourceMapURL?.(url, dataUrl);
      console.log("[attachSourceMapURL] Done attaching source map.");
    } catch (err) {
      console.error("[onResourceAdded] Error in source map flow:", err);
    }
  }
);
