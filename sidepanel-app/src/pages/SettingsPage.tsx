import { Button, Group, Stack, Text } from "@mantine/core";
import {
  BackendConfigCard,
  MicrosoftExcelConfigCard,
  MyInfoCard,
} from "../components/agent";

type SettingsPageProps = {
  onBack: () => void;
};

export default function SettingsPage({ onBack }: SettingsPageProps) {
  return (
    <Stack className="settings-page" gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={800} size="xl">
            Settings
          </Text>
          <Text size="sm" c="dimmed">
            Backend and connected workspace configuration.
          </Text>
        </div>
        <Button variant="default" radius="xl" onClick={onBack}>
          Back
        </Button>
      </Group>

      <MyInfoCard />
      <BackendConfigCard />
      <MicrosoftExcelConfigCard />
    </Stack>
  );
}
