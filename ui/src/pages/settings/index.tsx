import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, PageHeader, SearchField, Segmented } from "@ui/kit";
import { showView, useViewActive, type SettingsSection } from "@ui/data";
import { SearchProvider } from "./search";
import { General } from "./general";
import { QuotaSettings } from "./quota";
import { AccountSection } from "./account";
import { CollectionSection } from "./collection";
import { PricingSection } from "./pricing/section";
import { PriceEditorSheet } from "./pricing/editor-sheet";
import { QuickFixSheet } from "./pricing/quick-fix-sheet";
import { startPricing } from "./pricing/store";
import { Privacy } from "./privacy";
import { About } from "./about";
import { ProfileSheet } from "./profile-sheet";
import { ExportSheet } from "./export-sheet";

const sections: { value: SettingsSection; label: string }[] = [
  { value: "pricing", label: "定价" }, { value: "general", label: "常规" }, { value: "account", label: "账号与同步" }, { value: "quota", label: "额度" }, { value: "collection", label: "采集" }, { value: "privacy", label: "数据与安全" }, { value: "about", label: "关于" },
];

// The settings page (M3, docs/m2/UI-MIG-M3-20261025.md; laid out by owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md):
// categories across the top as on Agent 管理, one shown at a time, pricing first because that is what it is mostly for; a
// search looks through all of them. The shell owns theme, collection, profile, demo state and export (window.settingsHost);
// this page offers window.settingsUi for the sidebar, the usage page and the native menu.
export function SettingsPage() {
  const root = useRef<HTMLDivElement>(null);
  useViewActive("settings");
  const [current, setCurrent] = useState<SettingsSection>("pricing"), [query, setQuery] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [profileOpen, setProfileOpen] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const onVisibility = useCallback((section: SettingsSection, shown: boolean) => setVisible(state => state[section] === shown ? state : { ...state, [section]: shown }), []);

  const scrollTo = useCallback((section: SettingsSection) => { setCurrent(section); window.scrollTo({ top: 0 }); }, []);
  useEffect(() => { startPricing(); }, []);
  useEffect(() => {
    window.settingsUi = Object.freeze({
      openProfile: () => setProfileOpen(true),
      openExport: () => setExportOpen(true),
      // The shell resets the scroll position after switching views, so scroll on the next frame.
      openSection: (section: SettingsSection) => { showView("settings"); requestAnimationFrame(() => scrollTo(section)); },
    });
    return () => { delete window.settingsUi; };
  }, [scrollTo]);

  const searching = Boolean(query.trim()), nothing = searching && sections.every(section => visible[section.value] === false);
  return <div ref={root} className="mx-auto flex w-full max-w-205 flex-col gap-6" data-settings-page>
    <PageHeader title="设置" actions={<div className="w-64"><SearchField value={query} onChange={setQuery} placeholder="搜索设置项..." maxLength={60} aria-label="搜索设置项" /></div>} />
    <Segmented value={current} onChange={scrollTo} aria-label="设置分类" items={sections.map(section => ({ ...section, disabled: searching && visible[section.value] === false }))} />
    <SearchProvider query={query} current={current} onVisibility={onVisibility}>
      <div className="flex flex-col gap-8">
        <PricingSection />
        <General onEditProfile={() => setProfileOpen(true)} />
        <AccountSection active={current === "account"} />
        <QuotaSettings />
        <CollectionSection />
        <Privacy onExport={() => setExportOpen(true)} />
        <About />
        {nothing ? <EmptyState message="未找到匹配的设置项。按 ESC 清空搜索。" /> : null}
      </div>
    </SearchProvider>
    <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
    <ExportSheet open={exportOpen} onOpenChange={setExportOpen} />
    <PriceEditorSheet />
    <QuickFixSheet />
  </div>;
}
