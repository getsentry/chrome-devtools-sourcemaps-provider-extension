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

// Create a panel in DevTools
chrome.devtools.panels.create(
  "Sentry Maps", // Panel title
  "", // Icon path (empty for default)
  "", // Panel HTML page (empty - we'll handle mapping via script)
  (panel) => {
    console.log("Sentry Sourcemap Provider DevTools panel created");
  }
);

// Load the configuration when DevTools are opened
function loadConfig(): Promise<Config> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sentryAuthToken", "projectConfigs"], (result) => {
      config = {
        sentryAuthToken: result.sentryAuthToken || null,
        projectConfigs: result.projectConfigs || [],
      };
      console.log(
        "Config loaded:",
        config.sentryAuthToken ? "Auth token present" : "No auth token",
        `Project configs: ${config.projectConfigs.length}`
      );
      resolve(config);
    });
  });
}

// Listen for changes to the stored configuration
chrome.storage.onChanged.addListener((changes) => {
  console.log("Storage changes detected", changes);

  if (changes.sentryAuthToken) {
    config.sentryAuthToken = changes.sentryAuthToken.newValue;
    console.log(
      "Auth token updated:",
      config.sentryAuthToken ? "Token present" : "Token removed"
    );
  }

  if (changes.projectConfigs) {
    config.projectConfigs = changes.projectConfigs.newValue || [];
    console.log("Project configs updated:", config.projectConfigs.length);
  }
});

// Check if the current URL matches any project configurations
function findMatchingConfigs(url: string): ProjectConfig[] {
  return config.projectConfigs.filter((projectConfig) => {
    try {
      const regexPattern = projectConfig.urlPattern.replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(url);
    } catch (e) {
      console.error("Invalid URL pattern in config:", projectConfig.urlPattern);
      return false;
    }
  });
}

// Initialize configuration when script loads
loadConfig().then(() => {
  console.log("DevTools extension initialized");
});

// Listen for resources being added to the page
chrome.devtools.inspectedWindow.onResourceAdded.addListener(
  async (resource) => {
    // Make sure we have the latest config
    const currentConfig = await loadConfig();

    if (!currentConfig.sentryAuthToken) {
      console.log("No auth token configured, skipping source map lookup");
      return;
    }

    // Check if this resource's URL matches any of our project configurations
    const url = resource.url;
    const matchingConfigs = findMatchingConfigs(url);

    if (matchingConfigs.length > 0) {
      console.log("Resource URL matches project config(s):", resource.url);
      console.log(
        "Matching projects:",
        matchingConfigs.map((c) => `${c.organizationName}/${c.projectName}`)
      );

      // Here you would add code to fetch and apply source maps
      // This part will be implemented in the future
    }
  }
);
