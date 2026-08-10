"use client";

import { Panel } from "@/components/ui/Panel";
import { Field, FormGrid, NumberInput, Select, TextInput } from "@/components/ui/Field";
import {
  AI_DEPTHS, BUILD_STATUSES, SUPPORT_LOADS,
  type AiDepth, type BuildStatus, type Quote, type SupportLoad,
} from "@/lib/types";

export function BuildPanel({
  quote,
  onPatch,
}: {
  quote: Quote;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const a = quote.attributes;
  const setAttr = (p: Partial<Quote["attributes"]>) =>
    onPatch({ attributes: { ...a, ...p } });

  return (
    <Panel title="Build">
      <FormGrid>
        <Field
          label="Build status"
          hint="Licensing something already built does not lower the price — it lowers the floor, so the whole range becomes margin."
        >
          <Select
            options={BUILD_STATUSES}
            value={a.buildStatus}
            onChange={(e) => setAttr({ buildStatus: e.target.value as BuildStatus })}
          />
        </Field>
        <Field label="Surfaces" hint="Screens or sections.">
          <NumberInput
            value={a.surfaces}
            min={0}
            onChange={(e) => setAttr({ surfaces: Number(e.target.value) })}
          />
        </Field>
        <Field label="Integrations" hint="Comma separated, e.g. Gmail, Xero.">
          <TextInput
            value={a.integrations.join(", ")}
            onChange={(e) =>
              setAttr({
                integrations: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="Data sources">
          <NumberInput
            value={a.dataSources}
            min={0}
            onChange={(e) => setAttr({ dataSources: Number(e.target.value) })}
          />
        </Field>
        <Field label="AI depth">
          <Select
            options={AI_DEPTHS}
            value={a.aiDepth}
            onChange={(e) => setAttr({ aiDepth: e.target.value as AiDepth })}
          />
        </Field>
        <Field label="Users">
          <NumberInput
            value={a.userCount}
            min={0}
            onChange={(e) => setAttr({ userCount: Number(e.target.value) })}
          />
        </Field>
        <Field label="Support load">
          <Select
            options={SUPPORT_LOADS}
            value={a.supportLoad}
            onChange={(e) => setAttr({ supportLoad: e.target.value as SupportLoad })}
          />
        </Field>
      </FormGrid>
    </Panel>
  );
}
