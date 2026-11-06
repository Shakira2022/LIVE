"use client";

import { useEffect, useRef, useState } from "react";
import type { EChartsOption, EChartsType } from "echarts";

type EChartsCore = typeof import("echarts/core");
let echartsCorePromise: Promise<EChartsCore> | null = null;

function loadEChartsCore() {
  if (!echartsCorePromise) {
    echartsCorePromise = Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]).then(([core, charts, components, renderers]) => {
      core.use([
        charts.BarChart,
        charts.LineChart,
        charts.PieChart,
        components.GridComponent,
        components.LegendComponent,
        components.TooltipComponent,
        components.MarkLineComponent,
        renderers.CanvasRenderer,
      ]);
      return core;
    });
  }
  return echartsCorePromise;
}

export function EChart({
  option,
  height = 300,
  label,
}: {
  option: EChartsOption;
  height?: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const latestOption = useRef(option);
  const [failed, setFailed] = useState(false);
  latestOption.current = option;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let chart: EChartsType | undefined;

    void loadEChartsCore().then((core) => {
      if (disposed || !containerRef.current) return;
      chart = core.init(container, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(latestOption.current, { notMerge: true });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(container);
    }).catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  if (failed) return <div role="status" className="grid place-items-center text-center text-sm text-[#718490]" style={{ width: "100%", height }}>Chart could not be loaded.</div>;
  return <div ref={containerRef} role="img" aria-label={label} style={{ width: "100%", height }} />;
}
