import { useEffect, useState } from "react";
import { Plus, ScanSearch, Sparkles, X } from "lucide-react";
import {
  ApiError,
  clearAssetManualAdjustment,
  getAiAssetTagSuggestions,
  getAssetTags,
  getAssetTagSuggestions,
  resetAssetComparisons,
  setAssetTags,
  suggestTags,
  type AiStatus,
  type AssetRecord,
  type TagRecord,
  type TagSuggestion
} from "../../api/client";
import { normalizeTagDraft } from "../library-state";
import {
  MediaFavoriteButton,
  MediaScoreControl
} from "../MediaCurationControls";
import { uniqueTagNames } from "../tags/tag-utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { AssetScoreBreakdown } from "./AssetScoreBreakdown";

interface AssetAnnotationPanelProps {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  isScoreSaving: boolean;
  onRankingChanged: () => void;
  onScoreChange: (
    asset: AssetRecord,
    input: { score?: number; favorite?: boolean }
  ) => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function AssetAnnotationPanel({
  aiStatus,
  asset,
  isScoreSaving,
  onRankingChanged,
  onScoreChange,
  onAssetUpdated,
  onAssetTagsUpdated
}: AssetAnnotationPanelProps) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagRecord[]>([]);
  const [smartTagSuggestions, setSmartTagSuggestions] = useState<
    TagSuggestion[]
  >([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [isRunningScoreAction, setIsRunningScoreAction] = useState(false);
  const [isResetComparisonOpen, setIsResetComparisonOpen] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingSmartTags, setIsLoadingSmartTags] = useState(false);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setTags([]);
    setTagInput("");
    setTagSuggestions([]);
    setSmartTagSuggestions([]);
    setAnnotationError(null);
    setIsResetComparisonOpen(false);

    getAssetTags(asset.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setTags(response.tags);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnnotationError("Unable to load tags.");
        }
      });

    return () => {
      controller.abort();
    };
  }, [asset.id]);

  useEffect(() => {
    const query = tagInput.trim();

    if (!query) {
      setTagSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8, signal: controller.signal })
        .then((response) => {
          if (!controller.signal.aborted) {
            const selectedNames = new Set(
              tags.map((tag) => tag.normalizedName)
            );
            setTagSuggestions(
              response.tags.filter(
                (tag) => !selectedNames.has(tag.normalizedName)
              )
            );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tagInput, tags]);

  function saveScore(input: {
    score?: number;
    favorite?: boolean;
  }) {
    setAnnotationError(null);
    onScoreChange(asset, input);
  }

  async function clearManualAdjustment() {
    setIsRunningScoreAction(true);
    setAnnotationError(null);

    try {
      const { asset: updatedAsset } = await clearAssetManualAdjustment(asset.id);
      onAssetUpdated(updatedAsset);
      onRankingChanged();
    } catch {
      setAnnotationError("Unable to remove the manual adjustment.");
    } finally {
      setIsRunningScoreAction(false);
    }
  }

  async function resetComparisons() {
    setIsRunningScoreAction(true);
    setAnnotationError(null);

    try {
      const response = await resetAssetComparisons(asset.id);
      onAssetUpdated(response.asset);
      onRankingChanged();
    } catch {
      setAnnotationError("Unable to reset comparisons.");
    } finally {
      setIsRunningScoreAction(false);
    }
  }

  async function saveTags(nextTagNames: string[]) {
    setIsSavingTags(true);
    setAnnotationError(null);

    try {
      const response = await setAssetTags(asset.id, uniqueTagNames(nextTagNames));
      setTags(response.tags);
      onAssetTagsUpdated(asset.id, response.tags);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(currentSuggestions, response.tags)
      );
      setTagInput("");
      setTagSuggestions([]);
    } catch {
      setAnnotationError("Unable to save tags.");
    } finally {
      setIsSavingTags(false);
    }
  }

  function addTag(rawTagName: string) {
    const tagName = normalizeTagDraft(rawTagName);

    if (!tagName) {
      return;
    }

    void saveTags([...tags.map((tag) => tag.displayName), tagName]);
  }

  function removeTag(tagId: string) {
    void saveTags(
      tags
        .filter((tag) => tag.id !== tagId)
        .map((tag) => tag.displayName)
    );
  }

  async function loadSmartTagSuggestions() {
    setIsLoadingSmartTags(true);
    setAnnotationError(null);

    try {
      const response = await getAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions(filterSavedSuggestions(response.suggestions, tags));
    } catch {
      setAnnotationError("Unable to load suggestions.");
    } finally {
      setIsLoadingSmartTags(false);
    }
  }

  async function loadAiTagSuggestions() {
    setIsLoadingAiTags(true);
    setAnnotationError(null);

    try {
      const response = await getAiAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(
          mergeTagSuggestions(currentSuggestions, response.suggestions),
          tags
        )
      );
    } catch (caught) {
      setAnnotationError(aiSuggestionErrorMessage(caught));
    } finally {
      setIsLoadingAiTags(false);
    }
  }

  return (
    <section className="annotation-panel" aria-label="Media annotations">
      <div className="annotation-row">
        <span className="annotation-label">Score</span>
        <div className="annotation-curation-controls">
          <MediaScoreControl
            disabled={isScoreSaving || isRunningScoreAction}
            mediaName={asset.name}
            score={asset.score}
            onChange={(score) => void saveScore({ score })}
          />
          <MediaFavoriteButton
            disabled={isScoreSaving || isRunningScoreAction}
            favorite={asset.favorite}
            mediaName={asset.name}
            onChange={(favorite) => void saveScore({ favorite })}
          />
        </div>
      </div>

      <AssetScoreBreakdown
        asset={asset}
        isResetOpen={isResetComparisonOpen}
        isSaving={isScoreSaving || isRunningScoreAction}
        onClearAdjustment={() => void clearManualAdjustment()}
        onReset={() => void resetComparisons()}
        onResetOpenChange={setIsResetComparisonOpen}
      />

      <div className="tag-editor">
        <div className="tag-editor-heading">
          <span className="annotation-label">Tags</span>
          <div className="tag-editor-heading-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  aria-label={
                    isLoadingSmartTags ? "Suggesting tags" : "Suggest tags"
                  }
                  disabled={isLoadingSmartTags || isSavingTags}
                  onClick={() => void loadSmartTagSuggestions()}
                >
                  <Sparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Suggest tags</TooltipContent>
            </Tooltip>
            {aiStatus?.enabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    aria-label={
                      isLoadingAiTags
                        ? "Analyzing image for tags"
                        : "Analyze image for tags"
                    }
                    disabled={isLoadingAiTags || isSavingTags}
                    onClick={() => void loadAiTagSuggestions()}
                  >
                    <ScanSearch />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Analyze image for tags</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
        {tags.length > 0 ? (
          <div className="tag-chip-list">
            {tags.map((tag) => (
              <span className="tag-chip" key={tag.id}>
                {tag.displayName}
                <Button
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ${tag.displayName}`}
                  disabled={isSavingTags}
                  onClick={() => removeTag(tag.id)}
                >
                  <X size={13} />
                </Button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="tag-entry-row">
          <Input
            value={tagInput}
            maxLength={48}
            placeholder="Add a tag"
            disabled={isSavingTags}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag(tagInput);
              }
            }}
          />
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            aria-label="Add tag"
            title="Add tag"
            disabled={isSavingTags || !tagInput.trim()}
            onClick={() => addTag(tagInput)}
          >
            <Plus size={15} />
          </Button>
        </div>

        {smartTagSuggestions.length ? (
          <div
            className="tag-suggestions smart-suggestions"
            aria-label="Suggested tags"
          >
            {smartTagSuggestions.map((suggestion) => (
              <Button
                size="sm"
                type="button"
                variant="outline"
                key={suggestion.normalizedName}
                title={`${suggestion.reason}; confidence ${Math.round(
                  suggestion.confidence * 100
                )}%`}
                disabled={isSavingTags}
                onClick={() => addTag(suggestion.displayName)}
              >
                <Sparkles size={13} />
                {suggestion.displayName}
              </Button>
            ))}
          </div>
        ) : null}

        {tagSuggestions.length ? (
          <div className="tag-suggestions">
            {tagSuggestions.map((tag) => (
              <Button
                size="sm"
                type="button"
                variant="outline"
                key={tag.id}
                disabled={isSavingTags}
                onClick={() => addTag(tag.displayName)}
              >
                {tag.displayName}
              </Button>
            ))}
          </div>
        ) : null}

        {annotationError ? (
          <span className="annotation-error">{annotationError}</span>
        ) : null}
      </div>
    </section>
  );
}

function aiSuggestionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to analyze media.";
  }

  switch (caught.code) {
    case "ai_disabled":
      return "AI suggestions are disabled.";
    case "ai_not_supported":
      return "Vision suggestions support images first.";
    case "ai_provider_failed":
      return "Local AI provider did not respond.";
    default:
      return "Unable to analyze media.";
  }
}

function filterSavedSuggestions(
  suggestions: TagSuggestion[],
  savedTags: TagRecord[]
): TagSuggestion[] {
  const savedTagNames = new Set(savedTags.map((tag) => tag.normalizedName));

  return suggestions.filter(
    (suggestion) => !savedTagNames.has(suggestion.normalizedName)
  );
}

function mergeTagSuggestions(
  currentSuggestions: TagSuggestion[],
  nextSuggestions: TagSuggestion[]
): TagSuggestion[] {
  const suggestions = new Map<string, TagSuggestion>();

  for (const suggestion of [...currentSuggestions, ...nextSuggestions]) {
    if (!suggestions.has(suggestion.normalizedName)) {
      suggestions.set(suggestion.normalizedName, suggestion);
    }
  }

  return [...suggestions.values()];
}
