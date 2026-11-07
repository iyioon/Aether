import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { normalizeTagDraft, normalizeTagIdentity } from "../library-state";
import { createUuid } from "../../lib/uuid";
import { clearRankingResumeState } from "../compare/ranking-resume-state";
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
  onBusyChange?: (busy: boolean) => void;
}

export function AssetAnnotationPanel({
  aiStatus,
  asset,
  isScoreSaving,
  onRankingChanged,
  onScoreChange,
  onAssetUpdated,
  onAssetTagsUpdated,
  onBusyChange
}: AssetAnnotationPanelProps) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagRecord[]>([]);
  const [smartTagSuggestions, setSmartTagSuggestions] = useState<
    TagSuggestion[]
  >([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [isRunningScoreAction, setIsRunningScoreAction] = useState(false);
  const [isResetComparisonOpen, setIsResetComparisonOpen] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [tagReloadToken, setTagReloadToken] = useState(0);
  const [isLoadingSmartTags, setIsLoadingSmartTags] = useState(false);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);
  const activeRef = useRef(true);
  const contextRef = useRef({ assetId: asset.id });
  if (contextRef.current.assetId !== asset.id)
    contextRef.current = { assetId: asset.id };
  const pendingTagsRef = useRef(new Set<string>());
  const pendingScoresRef = useRef(new Set<string>());
  const callbacksRef = useRef({
    onAssetUpdated,
    onAssetTagsUpdated,
    onRankingChanged
  });
  callbacksRef.current = {
    onAssetUpdated,
    onAssetTagsUpdated,
    onRankingChanged
  };
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(isSavingTags || isRunningScoreAction);
  }, [isSavingTags, isRunningScoreAction, onBusyChange]);

  useEffect(() => {
    setTags([]);
    setIsLoadingTags(true);
    setIsSavingTags(pendingTagsRef.current.has(asset.id));
    setIsRunningScoreAction(pendingScoresRef.current.has(asset.id));
    setIsLoadingSmartTags(false);
    setIsLoadingAiTags(false);
    setTagInput("");
    setTagSuggestions([]);
    setSmartTagSuggestions([]);
    setAnnotationError(null);
    setScoreError(null);
    setIsResetComparisonOpen(false);
  }, [asset.id]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingTags(true);
    setAnnotationError(null);
    getAssetTags(asset.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setTags(response.tags);
          setIsLoadingTags(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnnotationError("Tags could not be loaded. Try again.");
        }
      });

    return () => {
      controller.abort();
    };
  }, [asset.id, tagReloadToken]);

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

  function saveScore(input: { score?: number; favorite?: boolean }) {
    setScoreError(null);
    onScoreChange(asset, input);
  }

  async function clearManualAdjustment() {
    if (pendingScoresRef.current.has(asset.id)) return;
    const context = contextRef.current;
    pendingScoresRef.current.add(asset.id);
    setIsRunningScoreAction(true);
    setScoreError(null);

    try {
      const { asset: updatedAsset } = await clearAssetManualAdjustment(
        asset.id
      );
      if (!activeRef.current) return;
      callbacksRef.current.onAssetUpdated(updatedAsset);
      callbacksRef.current.onRankingChanged();
      toast.success("Manual adjustment removed", {
        id: `adjustment-reset-${asset.id}:${createUuid()}`
      });
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setScoreError(
          "The adjustment change could not be confirmed. Reopen Info to check the score."
        );
    } finally {
      pendingScoresRef.current.delete(asset.id);
      if (activeRef.current && contextRef.current === context)
        setIsRunningScoreAction(false);
    }
  }

  async function resetComparisons() {
    if (pendingScoresRef.current.has(asset.id)) return;
    const context = contextRef.current;
    pendingScoresRef.current.add(asset.id);
    setIsRunningScoreAction(true);
    setScoreError(null);

    try {
      const response = await resetAssetComparisons(asset.id);
      if (!activeRef.current) return;
      clearRankingResumeState();
      callbacksRef.current.onAssetUpdated(response.asset);
      callbacksRef.current.onRankingChanged();
      if (contextRef.current === context) setIsResetComparisonOpen(false);
      toast.success("Comparisons reset for 1 item", {
        id: `comparison-reset-${asset.id}:${createUuid()}`
      });
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setScoreError(
          "The reset could not be confirmed. Reopen Info to check comparisons before trying again."
        );
    } finally {
      pendingScoresRef.current.delete(asset.id);
      if (activeRef.current && contextRef.current === context)
        setIsRunningScoreAction(false);
    }
  }

  async function saveTags(nextTagNames: string[]) {
    if (isLoadingTags || pendingTagsRef.current.has(asset.id)) return;
    const names = uniqueTagNames(nextTagNames);
    const previous = new Set(tags.map((tag) => tag.normalizedName));
    if (
      names.length === previous.size &&
      names.every((name) => previous.has(normalizeTagIdentity(name)))
    )
      return;
    const context = contextRef.current;
    pendingTagsRef.current.add(asset.id);
    setIsSavingTags(true);
    setAnnotationError(null);

    try {
      const response = await setAssetTags(asset.id, names);
      if (!activeRef.current) return;
      callbacksRef.current.onAssetTagsUpdated(asset.id, response.tags);
      toast.success(
        `${names.length === 0 ? "Tags cleared for" : names.length > previous.size ? "Tags added to" : "Tags updated for"} 1 item`,
        { id: `tags-save-${asset.id}:${createUuid()}` }
      );
      if (contextRef.current !== context) return;
      setTags(response.tags);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(currentSuggestions, response.tags)
      );
      setTagInput("");
      setTagSuggestions([]);
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setAnnotationError(
          "Tag changes could not be confirmed. Close and reopen Info to check tags before trying again."
        );
    } finally {
      pendingTagsRef.current.delete(asset.id);
      if (activeRef.current && contextRef.current === context)
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
      tags.filter((tag) => tag.id !== tagId).map((tag) => tag.displayName)
    );
  }

  async function loadSmartTagSuggestions() {
    const context = contextRef.current;
    setIsLoadingSmartTags(true);
    setAnnotationError(null);

    try {
      const response = await getAssetTagSuggestions(asset.id, 8);
      if (!activeRef.current || contextRef.current !== context) return;
      setSmartTagSuggestions(
        filterSavedSuggestions(response.suggestions, tags)
      );
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setAnnotationError("Unable to load suggestions. Try again.");
    } finally {
      if (activeRef.current && contextRef.current === context)
        setIsLoadingSmartTags(false);
    }
  }

  async function loadAiTagSuggestions() {
    const context = contextRef.current;
    setIsLoadingAiTags(true);
    setAnnotationError(null);

    try {
      const response = await getAiAssetTagSuggestions(asset.id, 8);
      if (!activeRef.current || contextRef.current !== context) return;
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(
          mergeTagSuggestions(currentSuggestions, response.suggestions),
          tags
        )
      );
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setAnnotationError(aiSuggestionErrorMessage(caught));
    } finally {
      if (activeRef.current && contextRef.current === context)
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
        resetError={isResetComparisonOpen ? scoreError : null}
        onClearAdjustment={() => void clearManualAdjustment()}
        onReset={() => void resetComparisons()}
        onResetOpenChange={(open) => {
          if (!pendingScoresRef.current.has(asset.id)) {
            setScoreError(null);
            setIsResetComparisonOpen(open);
          }
        }}
      />
      {scoreError && !isResetComparisonOpen ? (
        <p className="annotation-error" role="alert">
          {scoreError}
        </p>
      ) : null}

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
                  disabled={isLoadingSmartTags || isSavingTags || isLoadingTags}
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
                    disabled={isLoadingAiTags || isSavingTags || isLoadingTags}
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
                <span className="tag-chip-label" title={tag.displayName}>
                  {tag.displayName}
                </span>
                <Button
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ${tag.displayName}`}
                  disabled={isSavingTags || isLoadingTags}
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
            aria-label="Add a tag"
            value={tagInput}
            maxLength={48}
            placeholder="Add a tag"
            disabled={isSavingTags || isLoadingTags}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
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
            disabled={isSavingTags || isLoadingTags || !tagInput.trim()}
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
                disabled={isSavingTags || isLoadingTags}
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
                disabled={isSavingTags || isLoadingTags}
                onClick={() => addTag(tag.displayName)}
              >
                {tag.displayName}
              </Button>
            ))}
          </div>
        ) : null}

        {annotationError ? (
          <>
            <span className="annotation-error" role="alert">
              {annotationError}
            </span>
            {isLoadingTags ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setTagReloadToken((current) => current + 1)}
              >
                Retry tags
              </Button>
            ) : null}
          </>
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
      return "Tag suggestions are disabled.";
    case "ai_not_supported":
      return "Vision suggestions support images first.";
    case "ai_provider_failed":
      return "The tag suggestion provider did not respond.";
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
