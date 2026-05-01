import { useCallback, useState } from "react";
import { AppShell, Button, Group } from "@mantine/core";
import RunAgentPage from "./pages/RunAgentPage";
import RunTemplatePage from "./pages/RunTemplatePage";
import SavedArtifactsPage from "./pages/SavedArtifactsPage";
import type { SavedArtifactSummary } from "./hooks/useSavedArtifacts";
import type { RunLaunchRequest } from "./hooks/useAgentLaunchRequest";
import { AgentUXProvider } from "./providers";

type Page = "run" | "saved" | "template";

export default function App() {
  const [page, setPage] = useState<Page>("run");
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
    setPage("run");
  }, []);

  const handleOpenSavedPage = useCallback(() => {
    setPage("saved");
  }, []);

  const handleBackFromTemplate = useCallback(() => {
    setPage("saved");
  }, []);

  return (
    <AppShell padding="md">
      <AppShell.Header p="sm">
        <Group justify="space-between">
          <strong>WebGPT</strong>
          <Group>
            <Button
              size="xs"
              variant={page === "run" ? "filled" : "light"}
              onClick={handleOpenRunPage}
            >
              Run
            </Button>
            <Button
              size="xs"
              variant={page === "saved" ? "filled" : "light"}
              onClick={handleOpenSavedPage}
            >
              Saved
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AgentUXProvider>
        <AppShell.Main pt="60px">
          {page === "run" ? (
            <RunAgentPage
              launchRequest={launchRequest}
              onLaunchRequestHandled={handleLaunchRequestHandled}
            />
          ) : null}

          {page === "saved" ? (
            <SavedArtifactsPage onOpenArtifact={handleOpenArtifact} />
          ) : null}

          {page === "template" && selectedArtifact ? (
            <RunTemplatePage
              artifact={selectedArtifact}
              onBack={handleBackFromTemplate}
            />
          ) : null}
        </AppShell.Main>{" "}
      </AgentUXProvider>
    </AppShell>
  );
}
