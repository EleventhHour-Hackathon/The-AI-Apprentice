import { Textarea } from "@/components/ui/text-area";
import { cn } from "@/lib/utils";

const ChatInput = (
    className: string,
    onChange: any,
    props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) => {
    return (
        <Textarea
            autoComplete="off"
            name="message"
            className={cn(
                "max-h-12 px-4 py-3 bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 w-full rounded-md flex items-center h-16 resize-none",
                className
            )}
            onChange={onChange}
            {...props}
        />
    );
};
ChatInput.displayName = "ChatInput";

export { ChatInput };
