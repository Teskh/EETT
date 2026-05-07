import type { ReactNode } from "react";

export function FactoryQuantityLabel() {
  return (
    <span className="whitespace-nowrap">
      Q<sub className="normal-case tracking-normal">fábrica</sub>
    </span>
  );
}

export function WorkQuantityLabel() {
  return (
    <span className="whitespace-nowrap">
      Q<sub className="normal-case tracking-normal">obra</sub>
    </span>
  );
}

export function renderQuantityText(value: string): ReactNode {
  const parts = value.split(/(Q_fábrica|Q_obra)/g);
  return parts.map((part, index) => {
    if (part === "Q_fábrica") {
      return <FactoryQuantityLabel key={`${part}-${index}`} />;
    }
    if (part === "Q_obra") {
      return <WorkQuantityLabel key={`${part}-${index}`} />;
    }
    return part;
  });
}
