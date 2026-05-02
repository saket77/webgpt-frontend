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
  onAccept: () => void;
  onCancel: () => void;
};

export function PreRunDisclosureModal({
  opened,
  loading = false,
  onAccept,
  onCancel,
}: PreRunDisclosureModalProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Before WebGPT runs"
      centered
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
    >
      <Stack gap="sm">
        <Text size="sm">
          WebGPT needs access to the current website so it can observe the page,
          plan the next step, and execute actions you request.
        </Text>

        <List size="sm" spacing={4}>
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
            Does not use background browsing, cookies, history, downloads, or
            remote extension code.
          </List.Item>
        </List>

        <Alert color="blue" variant="light">
          Chrome will ask you to grant website access. WebGPT uses this access
          for browser automation on sites you choose to run it on.
        </Alert>

        <Checkbox
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          label="I understand and want to allow WebGPT to run on websites I choose."
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onAccept} disabled={!confirmed} loading={loading}>
            Continue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
