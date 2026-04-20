import { useState } from "react";
import { Smile } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Sorrisos",
    emojis: ["😀", "😁", "😄", "😊", "🥰", "😍", "🤩", "😎", "🤗", "😉", "🙂", "😌", "😋", "🤤", "😏"],
  },
  {
    label: "Gestos",
    emojis: ["👍", "👏", "🙌", "🤝", "🙏", "👌", "✌️", "🤙", "💪", "🫶", "👋", "🤘", "👇", "👆", "👊"],
  },
  {
    label: "Coração & Top",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✨", "⭐", "🌟", "🔥", "💎", "🏆"],
  },
  {
    label: "Barbearia",
    emojis: ["💈", "✂️", "🪒", "💇‍♂️", "🧔", "🧔‍♂️", "👨", "🧴", "💆‍♂️", "🕴️", "🎩", "🧢", "👔", "🪞", "🧖‍♂️"],
  },
  {
    label: "Reações",
    emojis: ["😮", "😲", "🤯", "🥳", "🎉", "🎊", "👀", "💬", "✅", "❌", "⚡", "🚀", "🆗", "💥", "🌈"],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "start" | "center" | "end";
  className?: string;
}

export function EmojiPicker({
  onSelect,
  disabled,
  size = "md",
  align = "end",
  className,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const btnSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Inserir emoji"
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground transition-colors hover:text-gold hover:border-gold/40 hover:bg-gold/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-50 disabled:cursor-not-allowed",
            btnSize,
            className,
          )}
        >
          <Smile className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-72 p-2 max-h-72 overflow-y-auto"
      >
        <div className="space-y-3">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1 px-1 font-body font-semibold">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onSelect(e);
                      setOpen(false);
                    }}
                    className="text-lg leading-none p-1.5 rounded hover:bg-gold/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                    aria-label={`Inserir ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
