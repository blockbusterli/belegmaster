import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Upload from "@/pages/Upload";
import Reconciliation from "@/pages/Reconciliation";
import Platforms from "@/pages/Platforms";
import AppleReceipts from "@/pages/AppleReceipts";
import EmailScanner from "@/pages/EmailScanner";
import DesktopReceipts from "@/pages/DesktopReceipts";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Layout>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/upload" component={Upload} />
            <Route path="/reconciliation/:id" component={Reconciliation} />
            <Route path="/reconciliation" component={Reconciliation} />
            <Route path="/platforms" component={Platforms} />
            <Route path="/apple-receipts" component={AppleReceipts} />
            <Route path="/email-scanner" component={EmailScanner} />
            <Route path="/desktop-receipts" component={DesktopReceipts} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
