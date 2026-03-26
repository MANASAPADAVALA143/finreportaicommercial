import React, { useState, useEffect, useMemo } from 'react';
import { Brain, ArrowLeft, Upload, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MorningBrief from '../components/cfo-decision/MorningBrief';
import InvestmentDecision from '../components/cfo-decision/InvestmentDecision';
import BuildVsBuy from '../components/cfo-decision/BuildVsBuy';
import InternalVsExternal from '../components/cfo-decision/InternalVsExternal';
import HireVsAutomate from '../components/cfo-decision/HireVsAutomate';
import RiskDashboard from '../components/cfo-decision/RiskDashboard';
import DecisionAuditTrail from '../components/cfo-decision/DecisionAuditTrail';
import CFODecisionUploadModal from '../components/cfo-decision/CFODecisionUploadModal';
import { morningBriefData } from '../data/decisionMockData';
import { AuditTrailEntry } from '../types/decisions';
import type { MorningBriefItem } from '../types/decisions';
import { loadCFODecisionData } from '../services/cfoDecisionDataService';

const CFODecisionIntelligence: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('investment');
  const [savedDecisions, setSavedDecisions] = useState<AuditTrailEntry[]>([]);
  const [showMorningBrief, setShowMorningBrief] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedData, setUploadedData] = useState(loadCFODecisionData());

  // On mount: read from localStorage so dashboard upload data appears (avoids stale initial state)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('finreport_cfo_decisions');
      if (raw) {
        const data = JSON.parse(raw);
        setUploadedData(data);
      }
    } catch (e) {
      console.error('CFO Decision load error', e);
    }
  }, []);

  const tabs = [
    { id: 'investment', name: 'Investment Decision', icon: '💰' },
    { id: 'build_vs_buy', name: 'Build vs Buy', icon: '🏗️', badge: 'NEW' },
    { id: 'internal_vs_external', name: 'Internal vs External', icon: '🔄', badge: 'NEW' },
    { id: 'hire_vs_automate', name: 'Hire vs Automate', icon: '👥' },
    { id: 'cost_cut', name: 'Cost Cut vs Invest', icon: '✂️' },
    { id: 'capital', name: 'Capital Allocation', icon: '🏢' },
    { id: 'risk', name: 'Risk Dashboard', icon: '⚠️' },
    { id: 'audit', name: 'Decision Audit Trail', icon: '📋', badge: 'UNIQUE' }
  ];

  const handleSaveToAudit = (decision: any) => {
    const auditEntry: AuditTrailEntry = {
      id: decision.id,
      date: decision.date,
      type: decision.type,
      title: decision.title,
      aiOutcome: decision.aiOutcome,
      cfoOutcome: decision.cfoOverride || decision.aiOutcome,
      tracked: false,
      confidence: decision.confidence
    };

    setSavedDecisions(prev => [auditEntry, ...prev]);
  };

  const handleMorningBriefAction = (actionType: string) => {
    setActiveTab(actionType);
    setShowMorningBrief(false);
  };

  // When user has uploaded data, build Morning Brief from it so they see "something coming"
  const morningBriefItems: MorningBriefItem[] = useMemo(() => {
    if (!uploadedData) return morningBriefData;
    const items: MorningBriefItem[] = [];
    if (uploadedData.investment?.length > 0) {
      const p = uploadedData.investment[0];
      const roi = p.yearlyRevenue && p.investment ? ((p.yearlyRevenue - (p.yearlyCost || 0)) / p.investment * 100) : 0;
      items.push({
        urgency: roi < 15 ? 'warning' : 'info',
        title: `${p.projectName || 'Investment'} — ROI ${roi.toFixed(0)}%`,
        decision: roi < 15 ? 'Review project economics' : 'No action needed',
        impact: p.investment ? `₹${(p.investment / 1e5).toFixed(1)}L investment` : '—',
        action: 'investment'
      });
    }
    if (uploadedData.risks?.length > 0) {
      const r = uploadedData.risks.find((x: any) => (x.riskScore || 0) >= 70) || uploadedData.risks[0];
      items.push({
        urgency: (r.riskScore || 0) >= 70 ? 'critical' : (r.riskScore || 0) >= 50 ? 'warning' : 'info',
        title: r.riskCategory || r.riskDescription || 'Risk item',
        decision: (r.riskScore || 0) >= 70 ? 'Review mitigation' : 'Monitor',
        impact: r.riskDescription || `Score ${r.riskScore || 0}`,
        action: 'risk'
      });
    }
    if (uploadedData.buildVsBuy?.length > 0) {
      items.push({
        urgency: 'info',
        title: `${uploadedData.buildVsBuy.length} Build vs Buy scenario(s) loaded`,
        decision: 'Review in Build vs Buy tab',
        impact: '—',
        action: 'build_vs_buy'
      });
    }
    if (items.length === 0) return morningBriefData;
    return items;
  }, [uploadedData]);

  const criticalCount = morningBriefItems.filter(item => item.urgency === 'critical' || item.urgency === 'warning').length;
  const resolvedCount = morningBriefItems.filter(item => item.urgency === 'info').length;
  const hasUploadedData = uploadedData && (
    (uploadedData.investment?.length ?? 0) > 0 ||
    (uploadedData.risks?.length ?? 0) > 0 ||
    (uploadedData.buildVsBuy?.length ?? 0) > 0
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl shadow-lg p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Brain className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold">CFO Decision Intelligence</h1>
                  <p className="text-amber-50 text-sm">
                    Strategic decisions powered by AI
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-white text-amber-600 hover:bg-amber-50 rounded-lg transition-colors font-medium flex items-center gap-2 shadow-sm"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Data</span>
              </button>

              <button
                onClick={() => setShowMorningBrief(!showMorningBrief)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm flex items-center gap-2"
              >
                <span>🌅</span>
                <span className="font-medium">Morning Brief</span>
                {criticalCount > 0 && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                    {criticalCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('audit')}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm flex items-center gap-2"
              >
                <span>📋</span>
                <span className="font-medium">Decision Log</span>
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-6 text-sm">
            {criticalCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></span>
                <span className="text-white/90">
                  {criticalCount} decision{criticalCount > 1 ? 's' : ''} need attention today
                </span>
              </div>
            )}
            {resolvedCount > 0 && (
              <div className="flex items-center gap-2">
                <span>✅</span>
                <span className="text-white/90">
                  {resolvedCount} resolved automatically
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span>🤖</span>
              <span className="text-white/90">
                78% AI accuracy • {savedDecisions.length + 6} total decisions
              </span>
            </div>
          </div>
        </div>

        {/* Data loaded banner */}
        {hasUploadedData && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <span className="text-green-800 font-medium">Data loaded from upload — Morning Brief and tabs use your file.</span>
          </div>
        )}

        {/* Morning Brief (collapsible) */}
        {showMorningBrief && (
          <MorningBrief
            items={morningBriefItems}
            onActionClick={handleMorningBriefAction}
          />
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-medium transition-all whitespace-nowrap border-b-2 ${
                  activeTab === tab.id
                    ? 'border-amber-600 text-amber-600 bg-amber-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{tab.icon}</span>
                <span>{tab.name}</span>
                {tab.badge && (
                  <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                    tab.badge === 'NEW' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="transition-all duration-300">
          {activeTab === 'investment' && (
            <InvestmentDecision onSaveToAudit={handleSaveToAudit} />
          )}

          {activeTab === 'build_vs_buy' && (
            <BuildVsBuy onSaveToAudit={handleSaveToAudit} />
          )}

          {activeTab === 'internal_vs_external' && (
            <InternalVsExternal onSaveToAudit={handleSaveToAudit} />
          )}

          {activeTab === 'hire_vs_automate' && (
            <HireVsAutomate onSaveToAudit={handleSaveToAudit} />
          )}

          {activeTab === 'cost_cut' && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <div className="text-6xl mb-4">✂️</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                Cost Cut vs Invest Analyzer
              </h3>
              <p className="text-gray-600 mb-4">
                Limited budget — where to cut and where to invest?
              </p>
              <p className="text-sm text-gray-500">
                This module helps you balance cost savings with growth investments by analyzing your expense categories and recommending optimal allocation.
              </p>
            </div>
          )}

          {activeTab === 'capital' && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <div className="text-6xl mb-4">🏢</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                Capital Allocation Advisor
              </h3>
              <p className="text-gray-600 mb-4">
                How to deploy available capital for maximum return?
              </p>
              <p className="text-sm text-gray-500">
                This module optimizes your capital allocation across product development, market expansion, debt repayment, M&A, and cash reserves based on your risk appetite.
              </p>
            </div>
          )}

          {activeTab === 'risk' && <RiskDashboard />}

          {activeTab === 'audit' && (
            <DecisionAuditTrail savedDecisions={savedDecisions} />
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <CFODecisionUploadModal
          onClose={() => setShowUploadModal(false)}
          onUploadSuccess={() => {
            setUploadedData(loadCFODecisionData());
          }}
        />
      )}
    </div>
  );
};

export default CFODecisionIntelligence;
