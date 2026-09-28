import { useEffect, useState } from "react";
import { Plus, RotateCcw, ScanSearch, Sparkles, Trash2, X } from "lucide-react";
import {
  ApiError,
  clearAssetManualAdjustment,
  getAiAssetTagSuggestions,
  getAssetTags,
  getAssetTagSuggestions,
  resetAssetComparisons,
  setAssetTags,
  suggestTags,
  updateAssetScore,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface AssetAnnotationPanelProps {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  onRankingChanged: () => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function AssetAnnotationPanel({
  aiStatus,
  asset,
  onRankingChanged,
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
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [isResetComparisonOpen, setIsResetComparisonOpen] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingSmartTags, setIsLoadingSmartTags] = useState(false);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);

  useEffect(() => {
    let active = true;
    setTags([]);
    setTagInput("");
    setTagSuggestions([]);
    setSmartTagSuggestions([]);
    setAnnotationError(null);
    setIsResetComparisonOpen(false);

    getAssetTags(asset.id)
      .then((response) => {
        if (active) {
          setTags(response.tags);
        }
      })
      .catch(() => {
        if (active) {
          setAnnotationError("Unable to load tags.");
        }
      });

    return () => {
      active = false;
    };
  }, [asset.id]);

  useEffect(() => {
    const query = tagInput.trim();

    if (!query) {
      setTagSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8 })
        .then((response) => {
          if (active) {
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
          if (active) {
            setTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tagInput, tags]);

  async function saveScore(input: {
    score?: number;
    favorite?: boolean;
  }) {
    setIsSavingScore(true);
    setAnnotationError(null);

    try {
      const { asset: updatedAsset } = await updateAssetScore(asset.id, input);
      onAssetUpdated(updatedAsset);
    } catch {
      setAnnotationError("Unable to save score.");
    } finally {
      setIsSavingScore(false);
    }
  }

  async function useComparisonScore() {
    setIsSavingScore(true);
    setAnnotationError(null);

    try {
      const { asset: updatedAsset } = await clearAssetManualAdjustment(asset.id);
      onAssetUpdated(updatedAsset);
      onRankingChanged();
    } catch {
      setAnnotationError("Unable to remove the manual adjustment.");
    } finally {
      setIsSavingScore(false);
    }
  }

  async function resetComparisons() {
    setIsSavingScore(true);
    setAnnotationError(null);

    try {
      const response = await resetAssetComparisons(asset.id);
      onAssetUpdated(response.asset);
      onRankingChanged();
    } catch {
      setAnnotationError("Unable to reset comparisons.");
    } finally {
      setIsSavingScore(false);
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
            disabled={isSavingScore}
            mediaName={asset.name}
            score={asset.score}
            onChange={(score) => void saveScore({ score })}
          />
          <MediaFavoriteButton
            disabled={isSavingScore}
            favorite={asset.favorite}
            mediaName={asset.name}
            onChange={(favorite) => void saveScore({ favorite })}
          />
        </div>
      </div>

      <div className="score-breakdown">
        <div className="score-breakdown-values">
          {asset.ranking ? (
            <>
              <span>
                Comparison
                <span className="score-breakdown-value">
                  <strong>{asset.ranking.comparisonScore}</strong>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Reset ${asset.ranking.comparisonCount} comparisons for ${asset.name}`}
                        disabled={isSavingScore}
                        onClick={() => setIsResetComparisonOpen(true)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Reset this item’s comparisons and recalculate related
                      scores
                    </TooltipContent>
                  </Tooltip>
                </span>
              </span>
              <span>
                Manual adjustment
                <span className="score-breakdown-value">
                  <strong>
                    {formatSignedScore(asset.ranking.manualAdjustment)}
                  </strong>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove the manual score adjustment for ${asset.name}`}
                        disabled={
                          isSavingScore || asset.ranking.manualAdjustment === 0
                        }
                        onClick={() => void useComparisonScore()}
                      >
                        <RotateCcw />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Remove the manual adjustment and use the comparison score
                    </TooltipContent>
                  </Tooltip>
                </span>
              </span>
              <span>
                Final
                <strong>{asset.score}</strong>
              </span>
            </>
          ) : (
            <>
              <span>
                Comparison
                <strong>Not ranked</strong>
              </span>
              <span>
                Manual score
                <strong>{asset.score}</strong>
              </span>
              <span>
                Final
                <strong>{asset.score}</strong>
              </span>
            </>
          )}
        </div>
        <p>
          {asset.ranking
            ? "Final score adds the comparison score and manual adjustment, and never falls below 0."
            : "With no comparisons yet, the final score is the manual score."}
        </p>
        {asset.ranking ? (
          <AlertDialog
            open={isResetComparisonOpen}
            onOpenChange={setIsResetComparisonOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Reset comparisons for {asset.name}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes {asset.ranking.comparisonCount} active pair
                  {asset.ranking.comparisonCount === 1 ? "" : "s"} involving
                  this item and recalculates related scores. Manual scores stay
                  in place. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void resetComparisons()}
                >
                  Reset comparisons
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

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

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value}` : String(value);
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
