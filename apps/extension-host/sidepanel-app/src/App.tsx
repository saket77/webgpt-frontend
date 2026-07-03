import { useCallback, useState } from "react";
import { ActionIcon, AppShell, Group, Tooltip } from "@mantine/core";
import RunAgentPage from "./pages/RunAgentPage";
import RunTemplatePage from "./pages/RunTemplatePage";
import SavedArtifactsPage from "./pages/SavedArtifactsPage";
import SettingsPage from "./pages/SettingsPage";
import type { SavedArtifactSummary } from "./hooks/useSavedArtifacts";
import type { RunLaunchRequest } from "./hooks/useAgentLaunchRequest";
import { AgentUXProvider } from "./providers";

type Page = "home" | "saved" | "template" | "settings";

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 11 8.5-7 8.5 7" />
      <path d="M5.5 10v10h13V10" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

function RoutinesIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.25 2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.75v2" />
      <path d="M12 19.25v2" />
      <path d="m5.45 5.45 1.42 1.42" />
      <path d="m17.13 17.13 1.42 1.42" />
      <path d="M2.75 12h2" />
      <path d="M19.25 12h2" />
      <path d="m5.45 18.55 1.42-1.42" />
      <path d="m17.13 6.87 1.42-1.42" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [launchRequest, setLaunchRequest] = useState<RunLaunchRequest | null>(
    null,
  );
  const [selectedArtifact, setSelectedArtifact] =
    useState<SavedArtifactSummary | null>(null);

  const handleOpenArtifact = useCallback((artifact: SavedArtifactSummary) => {
    setSelectedArtifact(artifact);
    setPage("template");
  }, []);

  const handleLaunchRequestHandled = useCallback(() => {
    setLaunchRequest(null);
  }, []);

  const handleOpenRunPage = useCallback(() => {
    setSelectedArtifact(null);
    setPage("home");
  }, []);

  const handleOpenSavedPage = useCallback(() => {
    setPage("saved");
  }, []);

  const handleBackFromTemplate = useCallback(() => {
    setPage("saved");
  }, []);

  return (
    <AppShell padding={0}>
      <AppShell.Header className="app-header">
        <Group justify="flex-end" wrap="nowrap" h="100%">
          <Group gap={8} wrap="nowrap">
            <Tooltip label="Home">
              <ActionIcon
                className="nav-action"
                radius="md"
                variant="transparent"
                data-active={page === "home" ? "true" : undefined}
                onClick={handleOpenRunPage}
                aria-label="Home"
              >
                <HomeIcon />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Routines">
              <ActionIcon
                className="nav-action"
                radius="md"
                variant="transparent"
                data-active={
                  page === "saved" || page === "template" ? "true" : undefined
                }
                onClick={handleOpenSavedPage}
                aria-label="Routines"
              >
                <RoutinesIcon />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Settings">
              <ActionIcon
                className="nav-action"
                radius="md"
                variant="transparent"
                data-active={page === "settings" ? "true" : undefined}
                onClick={() => setPage("settings")}
                aria-label="Settings"
              >
                <SettingsIcon />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main className="app-main">
        {page === "home" ? (
          <AgentUXProvider key="home">
            <RunAgentPage
              launchRequest={launchRequest}
              onLaunchRequestHandled={handleLaunchRequestHandled}
            />
          </AgentUXProvider>
        ) : null}

        {page === "saved" ? (
          <SavedArtifactsPage onOpenArtifact={handleOpenArtifact} />
        ) : null}

        {page === "template" && selectedArtifact ? (
          <AgentUXProvider
            key={`template-${
              selectedArtifact.successfulReplayArtifactFileName ||
              selectedArtifact.goal ||
              "routine"
            }`}
          >
            <RunTemplatePage
              artifact={selectedArtifact}
              onBack={handleBackFromTemplate}
            />
          </AgentUXProvider>
        ) : null}

        {page === "settings" ? (
          <SettingsPage onBack={handleOpenRunPage} />
        ) : null}
      </AppShell.Main>
    </AppShell>
  );
}
