import "./popup.css";
import { StrictMode, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  useSentryAuthToken,
  useProjectConfigs,
} from "./hooks/useChromeStorageSync";

const queryClient = new QueryClient();

// Fetch current tab URL via Chrome API
const fetchCurrentUrl = (): Promise<string> =>
  new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0]?.url || "")
    )
  );

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <Popup />
    </StrictMode>
  </QueryClientProvider>
);

interface Organization {
  id: string;
  slug: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  organization: {
    slug: string;
    name: string;
  };
}

interface ProjectConfig {
  project: string;
  projectName: string;
  organization: string;
  organizationName: string;
  urlPattern: string;
}

export function Popup() {
  const [authToken, setAuthToken] = useState<string>("");
  const [status, setStatus] = useState<null | "saved" | "deleted" | "error">(
    null
  );
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [urlPattern, setUrlPattern] = useState<string>("");
  const storedAuthToken = useSentryAuthToken();
  const projectConfigs = useProjectConfigs();
  const hasExistingToken = !!storedAuthToken;
  const tokenIndicator = hasExistingToken
    ? "Token is stored and ready to use"
    : "";

  // Queries for organizations and projects
  const { data: organizations = [], isLoading: orgLoading } = useQuery<
    Organization[],
    Error
  >({
    queryKey: ["organizations", storedAuthToken],
    queryFn: () =>
      fetch("https://sentry.io/api/0/organizations/", {
        headers: { Authorization: `Bearer ${storedAuthToken}` },
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to fetch organizations");
        return res.json() as Promise<Organization[]>;
      }),
    enabled: !!storedAuthToken,
  });

  const { data: projects = [], isLoading: projLoading } = useQuery<
    Project[],
    Error
  >({
    queryKey: ["projects", selectedOrg],
    queryFn: () =>
      fetch(`https://sentry.io/api/0/organizations/${selectedOrg}/projects/`, {
        headers: { Authorization: `Bearer ${storedAuthToken}` },
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to fetch projects");
        return res.json() as Promise<Project[]>;
      }),
    enabled: !!selectedOrg,
  });

  // Query current URL
  const { data: currentUrl = "" } = useQuery<string, Error>({
    queryKey: ["currentUrl"],
    queryFn: fetchCurrentUrl,
  });

  // Compute suggested URL pattern
  const suggestedUrlPattern = useMemo(() => {
    if (!currentUrl) return "";
    try {
      const url = new URL(currentUrl);
      return `${url.origin}/*`;
    } catch {
      return "";
    }
  }, [currentUrl]);

  // Derive matching projects
  const matchingProjects = useMemo(
    () =>
      projectConfigs.filter((config) =>
        urlMatchesPattern(currentUrl, config.urlPattern)
      ),
    [currentUrl, projectConfigs]
  );

  const validateToken = (token: string): boolean => {
    return token.startsWith("sntryu_");
  };

  function urlMatchesPattern(url: string, pattern: string): boolean {
    try {
      // Convert the pattern to a regex by replacing * with .*
      const regexPattern = pattern.replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(url);
    } catch (error) {
      console.error("Invalid URL pattern:", error);
      return false;
    }
  }

  const saveToken = () => {
    setStatus(null);

    if (!validateToken(authToken)) {
      setStatus("error");
      setStatusMessage(
        "Invalid token format. Sentry auth tokens must start with 'sntryu_'"
      );
      return;
    }

    // Store the token first
    chrome.storage.sync.set({ sentryAuthToken: authToken }, () => {
      setStatus("saved");
      setStatusMessage(
        "Token was successfully saved and is now stored securely."
      );
      setAuthToken(""); // Clear the input field
    });
  };

  const saveProjectSettings = () => {
    if (!selectedOrg) {
      setStatus("error");
      setStatusMessage("Please select an organization.");
      return;
    }

    if (!selectedProject) {
      setStatus("error");
      setStatusMessage("Please select a project.");
      return;
    }

    // Use suggested pattern if user hasn't entered a custom one
    const patternToUse = urlPattern || suggestedUrlPattern;
    if (!patternToUse) {
      setStatus("error");
      setStatusMessage("Please enter a URL pattern.");
      return;
    }

    // Find the selected project and org details
    const project = projects.find((p) => p.slug === selectedProject);
    const org = organizations.find((o) => o.slug === selectedOrg);

    if (!project || !org) {
      setStatus("error");
      setStatusMessage("Selected project or organization not found.");
      return;
    }

    // Create a new project config
    const newConfig: ProjectConfig = {
      project: selectedProject,
      projectName: project.name,
      organization: selectedOrg,
      organizationName: org.name,
      urlPattern: patternToUse,
    };

    // Add to existing configs or create new array
    const updatedConfigs = [...projectConfigs, newConfig];

    chrome.storage.sync.set(
      {
        projectConfigs: updatedConfigs,
      },
      () => {
        setStatus("saved");
        setStatusMessage("Project configuration was successfully saved.");

        // Clear the form fields
        setSelectedProject("");
        setUrlPattern("");
      }
    );
  };

  const removeToken = () => {
    setStatus(null);
    chrome.storage.sync.remove(["sentryAuthToken", "projectConfigs"], () => {
      setStatus("deleted");
      setStatusMessage("All configuration was successfully removed.");
      setSelectedOrg("");
      setSelectedProject("");
      setUrlPattern("");
    });
  };

  const removeProjectConfig = (index: number) => {
    const updatedConfigs = [...projectConfigs];
    updatedConfigs.splice(index, 1);

    chrome.storage.sync.set({ projectConfigs: updatedConfigs }, () => {
      setStatus("deleted");
      setStatusMessage("Project configuration was successfully removed.");
    });
  };

  const removeAuthToken = () => {
    setStatus(null);
    chrome.storage.sync.remove(["sentryAuthToken"], () => {
      setStatus("deleted");
      setStatusMessage("Auth token was successfully removed.");
      setSelectedOrg("");
      setSelectedProject("");
    });
  };

  return (
    <>
      <h1>Sentry Sourcemap Provider</h1>

      {!hasExistingToken ? (
        // Only show authentication section when no token exists
        <div className="section">
          <h2>Authentication</h2>
          <div className="form-group">
            <label htmlFor="authToken">Sentry Auth Token:</label>
            <input
              id="authToken"
              type="password"
              placeholder="Enter your Sentry auth token (sntryu_...)"
              value={authToken}
              onChange={(e) => {
                setAuthToken(e.target.value);
              }}
            />
            <div className="hint">
              Get a Sentry auth token at{" "}
              <a
                href="https://sentry.io/settings/account/api/auth-tokens/"
                target="_blank"
                rel="noopener noreferrer"
              >
                sentry.io/settings/account/api/auth-tokens/
              </a>
            </div>
            <div className="hint">Token must start with 'sntryu_'</div>
          </div>
          <div className="form-group">
            <button onClick={saveToken} disabled={!authToken}>
              Save Token
            </button>
          </div>

          {status && (
            <div
              className={`status ${status === "error" ? "error" : "success"}`}
            >
              {statusMessage}
            </div>
          )}
        </div>
      ) : (
        // Show sections when token exists
        <>
          <div className="section">
            <h2>Authentication</h2>
            {tokenIndicator && (
              <div className="token-indicator success">{tokenIndicator}</div>
            )}
            <div className="form-group">
              <label htmlFor="authToken">Update Sentry Auth Token:</label>
              <input
                id="authToken"
                type="password"
                placeholder="Enter a new Sentry auth token (sntryu_...)"
                value={authToken}
                onChange={(e) => {
                  setAuthToken(e.target.value);
                }}
              />
              <div className="hint">
                Get a Sentry auth token at{" "}
                <a
                  href="https://sentry.io/settings/account/api/auth-tokens/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  sentry.io/settings/account/api/auth-tokens/
                </a>
              </div>
            </div>
            <div className="form-group">
              <button onClick={saveToken} disabled={!authToken}>
                Update Token
              </button>
              <button
                onClick={removeAuthToken}
                className="danger"
                style={{ marginLeft: "10px" }}
              >
                Delete Token
              </button>
            </div>
          </div>

          <div className="section">
            <h2>Project Configuration</h2>

            <div className="form-group">
              <label htmlFor="orgSelect">Select Sentry Organization:</label>
              {orgLoading ? (
                <div>Loading organizations...</div>
              ) : (
                <select
                  id="orgSelect"
                  value={selectedOrg}
                  onChange={(e) => setSelectedOrg(e.target.value)}
                >
                  <option value="">Select an organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.slug}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="projectSelect">Select Sentry Project:</label>
              {projLoading ? (
                <div>Loading projects...</div>
              ) : (
                <select
                  id="projectSelect"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  disabled={!selectedOrg || projects.length === 0}
                >
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.slug}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="urlPattern">URL Pattern:</label>
              <input
                id="urlPattern"
                type="text"
                placeholder={
                  suggestedUrlPattern || "e.g., https://example.com/*"
                }
                value={urlPattern || suggestedUrlPattern}
                onChange={(e) => setUrlPattern(e.target.value)}
              />
              <div className="hint">
                Pattern for URLs to apply the sourcemaps to (use * as wildcard)
              </div>
            </div>

            <div className="form-group">
              <button onClick={saveProjectSettings}>
                Add Project Configuration
              </button>
            </div>

            {status && (
              <div
                className={`status ${status === "error" ? "error" : "success"}`}
              >
                {statusMessage}
              </div>
            )}
          </div>

          {matchingProjects.length > 0 && (
            <div className="section">
              <h3>Matching Projects for Current URL:</h3>
              <ul className="matching-projects">
                {matchingProjects.map((project, index) => (
                  <li key={index} className="project-item">
                    <div className="project-info">
                      <div>
                        <strong>Organization:</strong>{" "}
                        {project.organizationName}
                      </div>
                      <div>
                        <strong>Project:</strong> {project.projectName}
                      </div>
                      <div>
                        <strong>URL Pattern:</strong> {project.urlPattern}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {projectConfigs.length > 0 && (
            <div className="section">
              <h3>All Project Configurations:</h3>
              <ul className="project-configs">
                {projectConfigs.map((config, index) => (
                  <li key={index} className="project-item">
                    <div className="project-info">
                      <div>
                        <strong>Organization:</strong> {config.organizationName}
                      </div>
                      <div>
                        <strong>Project:</strong> {config.projectName}
                      </div>
                      <div>
                        <strong>URL Pattern:</strong> {config.urlPattern}
                      </div>
                    </div>
                    <button
                      onClick={() => removeProjectConfig(index)}
                      className="remove-btn"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-group">
            <button onClick={removeToken} className="danger">
              Remove All Settings
            </button>
          </div>
        </>
      )}
    </>
  );
}
