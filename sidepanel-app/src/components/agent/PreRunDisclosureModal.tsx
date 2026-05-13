import {
  Alert,
  Button,
  Checkbox,
  Group,
  List,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";

type PreRunDisclosureModalProps = {
  opened: boolean;
  loading?: boolean;
  surface?: "browser_dom" | "google_sheets" | "microsoft_excel";
  onAccept: () => void;
  onCancel: () => void;
};

export function PreRunDisclosureModal({
  opened,
  loading = false,
  surface = "browser_dom",
  onAccept,
  onCancel,
}: PreRunDisclosureModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const isGoogleSheets = surface === "google_sheets";
  const isMicrosoftExcel = surface === "microsoft_excel";
  const isApiSurface = isGoogleSheets || isMicrosoftExcel;
  const productName = isMicrosoftExcel ? "Microsoft Excel" : "Google Sheets";

  const handleCancel = () => {
    setConfirmed(false);
    onCancel();
  };

  const handleAccept = () => {
    setConfirmed(false);
    onAccept();
  };

  return (
    <Modal
      className="disclosure-modal"
      opened={opened}
      onClose={handleCancel}
      title={isApiSurface ? `Connect ${productName}` : "Before WebGPT runs"}
      centered
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
    >
      <Stack gap="sm">
        <Text size="sm">
          {isApiSurface
            ? `WebGPT needs ${productName} access so it can read workbook state and execute the spreadsheet updates you request.`
            : "WebGPT needs access to the current website so it can observe the page, plan the next step, and execute actions you request."}
        </Text>

        <List size="sm" spacing={4}>
          {isApiSurface ? (
            <>
              <List.Item>
                Reads workbook title, sheet tabs, selected range, and a
                bounded grid snapshot.
              </List.Item>
              <List.Item>
                Executes curated spreadsheet API commands like reading, writing,
                appending, finding rows, formatting, and selecting ranges.
              </List.Item>
              <List.Item>
                Gets the {isMicrosoftExcel ? "Microsoft" : "Google"} token
                through Chrome on this device; WebGPT does not store spreadsheet
                tokens on the backend.
              </List.Item>
              <List.Item>
                Sends structured spreadsheet state and execution results to the
                configured backend only after you start a run.
              </List.Item>
            </>
          ) : (
            <>
              <List.Item>
                Reads visible page text, controls, URLs, and selected extracted
                content.
              </List.Item>
              <List.Item>
                Sends structured page state to the default or configured backend
                only after you start a run.
              </List.Item>
              <List.Item>
                Injects local extension scripts dynamically for user-initiated
                runs.
              </List.Item>
              <List.Item>
                Does not use background browsing, cookies, history, downloads,
                or remote extension code.
              </List.Item>
            </>
          )}
        </List>

        <Alert color="blue" variant="light">
          {isApiSurface
            ? `Chrome will ask you to connect your ${
                isMicrosoftExcel ? "Microsoft" : "Google"
              } account for ${productName} access. This is required before the planner loop starts on a spreadsheet.`
            : "Chrome will ask you to grant website access. WebGPT uses this access for browser automation on sites you choose to run it on."}
        </Alert>

        <Checkbox
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          label={
            isApiSurface
              ? `I understand and want to connect ${productName} for this WebGPT run.`
              : "I understand and want to allow WebGPT to run on websites I choose."
          }
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleAccept} disabled={!confirmed} loading={loading}>
            Continue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
