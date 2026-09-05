import { CheckCircle2, X } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { ToolbarMenu } from "./ToolbarMenu";

interface ActionsControlMenuProps {
  actionSummary: string;
  assets: AssetRecord[];
  isLoadingAssets: boolean;
  isOpen: boolean;
  isSavingBatch: boolean;
  selectedAssetCount: number;
  onClearSelectedAssets: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onSelectLoadedAssets: () => void;
  onSetOpenControlMenu: (menu: null) => void;
}

export function ActionsControlMenu({
  actionSummary,
  assets,
  isLoadingAssets,
  isOpen,
  isSavingBatch,
  selectedAssetCount,
  onClearSelectedAssets,
  onOpenChange,
  onSelectLoadedAssets,
  onSetOpenControlMenu
}: ActionsControlMenuProps) {
  return (
    <ToolbarMenu
      align="end"
      className="actions-control"
      icon={CheckCircle2}
      isOpen={isOpen}
      label="Actions"
      menuId="actions"
      valueLabel={actionSummary}
      onOpenChange={onOpenChange}
    >
      <div className="menu-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Selection</div>
          <small>{actionSummary}</small>
        </div>
        <div className="menu-option-list action-menu-list">
          <button
            className="menu-option action-menu-option"
            type="button"
            disabled={assets.length === 0 || isLoadingAssets}
            onClick={() => {
              onSelectLoadedAssets();
              onSetOpenControlMenu(null);
            }}
          >
            <span className="action-menu-label">
              <CheckCircle2 size={14} />
              <span>Select loaded</span>
            </span>
            <span className="action-menu-value">{assets.length}</span>
          </button>
          <button
            className="menu-option action-menu-option"
            type="button"
            disabled={selectedAssetCount === 0 || isSavingBatch}
            onClick={() => {
              onClearSelectedAssets();
              onSetOpenControlMenu(null);
            }}
          >
            <span className="action-menu-label">
              <X size={14} />
              <span>Clear selection</span>
            </span>
            <span className="action-menu-value">
              {selectedAssetCount || "None"}
            </span>
          </button>
        </div>
      </div>
    </ToolbarMenu>
  );
}
