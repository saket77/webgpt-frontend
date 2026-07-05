import { Badge, Group, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useAgentUX } from "../../providers";

type PageHeaderProps = {
  title: string;
  rightSection?: ReactNode;
};

export function PageHeader({ title, rightSection }: PageHeaderProps) {
  const { status } = useAgentUX();

  return (
    <Group justify="space-between" align="center">
      <Title order={3}>{title}</Title>

      <Group>
        <Badge variant="light">{status}</Badge>
        {rightSection}
      </Group>
    </Group>
  );
}
