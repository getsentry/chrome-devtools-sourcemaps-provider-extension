import "./popup.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);

export function Popup() {
  const [authToken, setAuthToken] = useState<string>("");
  const [status, setStatus] = useState<null | "saved" | "deleted">(null);

  useEffect(() => {
    chrome.storage.sync.get("sentryAuthToken", (result) => {
      const hasToken = !!result.sentryAuthToken;
      setHasExistingToken(hasToken);
    });
  }, []);

  const [hasExistingToken, setHasExistingToken] = useState<boolean>(false);

  const saveToken = () => {
    setStatus(null);
    chrome.storage.sync.set({ sentryAuthToken: authToken }, () => {
      setAuthToken("");
      setStatus("saved");
      setHasExistingToken(true);
    });
  };

  const removeToken = () => {
    setStatus(null);
    chrome.storage.sync.remove("sentryAuthToken", () => {
      setStatus("deleted");
      setHasExistingToken(false);
    });
  };

  return (
    <>
      <h1>Sentry Sourcemap Provider</h1>
      <div className="form-group">
        <label htmlFor="authToken">Sentry Auth Token:</label>
        <input
          type="password"
          placeholder="Enter your Sentry auth token"
          value={authToken}
          onChange={(e) => {
            setAuthToken(e.target.value);
          }}
        />
      </div>
      <div className="form-group">
        <button onClick={saveToken}>Save Token</button>
        {hasExistingToken && (
          <button onClick={removeToken} style={{ marginLeft: "10px" }}>
            Remove Token
          </button>
        )}
      </div>
      {status === "saved" ? (
        <div className="status success">Token was successfully saved.</div>
      ) : status === "deleted" ? (
        <div className="status success">Token was successfully removed.</div>
      ) : null}
    </>
  );
}
