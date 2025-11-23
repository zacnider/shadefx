import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import Header from './components/Header';
import Home from './pages/Home';
import Predictions from './pages/Predictions';
import Admin from './pages/Admin';
import Portfolio from './pages/Portfolio';
import Leaderboard from './pages/Leaderboard';
import { WalletProvider } from './contexts/WalletContext';
import { PRIVY_APP_ID, privyConfig, wagmiConfig } from './config/privy';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import 'preline/preline';

const queryClient = new QueryClient();

function AppContent() {
  const [selectedPair, setSelectedPair] = useState<string>('');

  return (
    <div className="App min-h-screen gradient-bg">
      <Header />
      <main className="main-content relative">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route 
            path="/predictions" 
            element={<Predictions selectedPair={selectedPair} onPairSelect={setSelectedPair} />} 
          />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={privyConfig}
      >
        <WagmiProvider config={wagmiConfig}>
          <WalletProvider>
            <Router>
              <AppContent />
            </Router>
          </WalletProvider>
        </WagmiProvider>
        <ToastContainer
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="dark"
          style={{ zIndex: 100000 }}
        />
      </PrivyProvider>
    </QueryClientProvider>
  );
}

export default App;
