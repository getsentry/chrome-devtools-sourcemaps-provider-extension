let storageLoaded = false;
let sentryAuthToken: string | null = null;
let sentryProject: string | null = null;

async function getAuthToken(): Promise<{
  sentryAuthToken: string | null;
  sentryProject: string | null;
}> {
  if (storageLoaded) {
    return {
      sentryAuthToken,
      sentryProject,
    };
  }
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["sentryAuthToken", "sentryProject"],
      ({
        sentryAuthToken: retrievedAuthToken,
        sentryProject: retrievedSentryProject,
      }) => {
        storageLoaded = true;
        sentryAuthToken = retrievedAuthToken;
        sentryProject = retrievedSentryProject;
        resolve(retrievedAuthToken);
      }
    );
  });
}

chrome.storage.onChanged.addListener(
  ({ sentryAuthToken: changedSentryAuthToken }) => {
    console.log(changedSentryAuthToken);
    sentryAuthToken = changedSentryAuthToken.newValue;
  }
);

chrome.devtools.inspectedWindow.onResourceAdded.addListener(
  async (resource) => {
    const currentAuthToken = await getAuthToken();
    console.log("Resource added:", resource);
    console.log("auth token", currentAuthToken);
  }
);
