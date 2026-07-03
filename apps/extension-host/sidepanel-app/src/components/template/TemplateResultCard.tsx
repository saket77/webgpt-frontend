import { Card, Stack, Text } from "@mantine/core";

export type TemplateResult = {
  inputLabel: string;
  inputValue: string;
  summary?: string;
};

type TemplateResultsCardProps = {
  results: TemplateResult[];
};

export function TemplateResultsCard({ results }: TemplateResultsCardProps) {
  if (results.length === 0) return null;

  return (
    <Card className="routine-results" withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700}>Completed summaries</Text>

        {results.map((result, index) => (
          <Card
            key={`${result.inputLabel}-${result.inputValue}-${index}`}
            withBorder
            radius="md"
            p="sm"
          >
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                {result.inputLabel}: {result.inputValue || "—"}
              </Text>

              <Text size="sm" c="dimmed">
                {result.summary || "No summary available"}
              </Text>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
