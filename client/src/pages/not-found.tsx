import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">Seite nicht gefunden</p>
      <Link href="/"><Button size="sm">Zum Dashboard</Button></Link>
    </div>
  );
}
