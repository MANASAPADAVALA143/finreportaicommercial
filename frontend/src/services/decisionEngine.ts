import { DecisionType, DecisionOutcome, ConfidenceFactor } from '../types/decisions';

// AI provider - using existing aiProvider.ts
import { callAI } from './aiProvider';

interface DecisionRecommendation {
  recommendation: string;
  outcome: DecisionOutcome;
  confidence: number;
  confidenceFactors: ConfidenceFactor[];
}

export const generateDecisionRecommendation = async (
  type: DecisionType,
  data: any
): Promise<DecisionRecommendation> => {

  const prompts: Record<DecisionType, string> = {

    investment: `You are a CFO advisor. Analyze this investment:
NPV: ₹${data.npv}, IRR: ${data.irr}%, Payback: ${data.payback} years
Hurdle rate: ${data.hurdleRate}%, Risk: ${data.risk}
Cash position: ₹${data.cashPosition}
Investment amount: ₹${data.investment}

Give: APPROVE / REJECT / CONDITIONAL with 2-3 specific sentences.
Be direct. Give exact numbers. Mention specific conditions if conditional.
Format your response clearly with the decision first, then reasoning.`,

    build_vs_buy: `You are a CFO technology advisor. Analyze Build vs Buy:
Build: ₹${data.buildCost} to develop, ₹${data.buildMaintenance}/year maintenance
Buy: ₹${data.buyCost}/year license, ₹${data.buySetup} setup
5-year build total: ₹${data.buildTotal}
5-year buy total: ₹${data.buyTotal}
Customization need: ${data.customizationNeed}
Team capability: ${data.teamCapability}
Time sensitivity: ${data.timeSensitivity}

Give: BUILD / BUY / HYBRID with clear financial reasoning.
Include specific risk mitigation step.
Be direct and actionable.`,

    internal_vs_external: `You are a CFO operations advisor. Analyze Outsourcing:
Function: ${data.function}
Internal cost: ₹${data.internalCost}/year, error rate: ${data.internalErrorRate}%
External cost: ₹${data.externalCost}/year, SLA error: ${data.externalErrorRate}%
Close cycle: Internal ${data.internalDays} days, External ${data.externalDays} days
Knowledge risk: ${data.knowledgeRisk}

Give: INTERNAL / EXTERNAL / HYBRID recommendation.
Include transition risk and specific mitigation.
Be direct with exact numbers.`,

    hire_vs_automate: `You are a CFO workforce advisor. Analyze:
Process: ${data.process}
Hire cost: ₹${data.hireCost}/year for ${data.hires} people
Automation: ₹${data.setupCost} one-time, ₹${data.monthlyCost}/month
Automation covers: ${data.automationPct}% of volume
Break-even: ${data.breakeven} months
5-year saving: ₹${data.fiveYearSaving}

Give: HIRE / AUTOMATE / HYBRID. Include redeployment plan for existing staff.
Be specific and actionable.`,

    cost_cut_vs_invest: `You are a CFO strategy advisor. Analyze budget allocation:
Available budget: ₹${data.budget}
Goal: ${data.goal}
Proposed cuts: ${data.cuts}
Proposed investments: ${data.investments}
Growth risk: ${data.growthRisk}
Morale impact: ${data.moraleImpact}

Give optimal recommendation with specific amounts.
Balance cost savings with growth potential.
Be direct and actionable.`,

    capital_allocation: `You are a CFO investment advisor:
Available capital: ₹${data.capital}
Risk appetite: ${data.riskAppetite}
Current runway: ${data.runway} months
Options: ${JSON.stringify(data.options)}
Minimum runway needed: ${data.minRunway} months

Give optimal allocation with amounts. Maximize risk-adjusted returns.
Protect minimum ${data.minRunway} month cash runway.
Be specific with exact amounts for each allocation.`,

    risk: `You are a CFO risk advisor. Company risk profile:
Liquidity: ${data.liquidity}/10, FX: ${data.fx}/10
Credit: ${data.credit}/10, Market: ${data.market}/10
Overall: ${data.overall}/10, Trend: ${data.trend}
Cash runway: ${data.runway} months

Give top 3 risks with specific action and timeline for each.
CFO language. Be direct and actionable.
Focus on immediate actions to mitigate highest risks.`
  };

  try {
    // Log the prompt for debugging
    console.log('🤖 Calling AI with prompt for type:', type);
    console.log('Prompt:', prompts[type].substring(0, 200) + '...');
    
    const response = await callAI(prompts[type]);
    
    console.log('✅ AI Response received:', response.substring(0, 200));
    
    // Extract confidence score from data
    const confidence = calculateConfidence(type, data);
    const confidenceFactors = generateConfidenceFactors(type, data);
    
    return {
      recommendation: response,
      outcome: extractOutcome(response, type),
      confidence,
      confidenceFactors
    };
  } catch (error: any) {
    console.error('❌ Error generating decision recommendation:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      type,
      dataKeys: Object.keys(data)
    });
    const msg = error?.message || '';
    const isCredentialError = /credentials|security token|invalid.*token|AWS|\.env/i.test(msg);
    return {
      recommendation: `Unable to generate recommendation. ${msg}${isCredentialError ? ' Use backend: set VITE_API_URL=http://localhost:8000 and configure backend/.env with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.' : ''}`,
      outcome: "review",
      confidence: 0,
      confidenceFactors: [{
        factor: "AI Service",
        status: "negative",
        impact: "high",
        detail: isCredentialError
          ? "Use backend for Nova: set VITE_API_URL=http://localhost:8000 in frontend/.env and put AWS keys in backend/.env, then restart both servers."
          : "AI service is not available. Check AWS credentials or backend .env file."
      }]
    };
  }
};

const calculateConfidence = (type: DecisionType, data: any): number => {
  let score = 70; // base confidence

  switch (type) {
    case "investment":
      if (data.npv > 0) score += 10;
      if (data.irr > data.hurdleRate + 5) score += 10;
      if (data.payback < 3) score += 5;
      if (data.cashPosition < data.investment * 0.5) score -= 15;
      if (data.risk === "low") score += 5;
      if (data.risk === "high") score -= 10;
      break;

    case "build_vs_buy":
      const costDiff = Math.abs(data.buildTotal - data.buyTotal);
      const costDiffPct = (costDiff / Math.max(data.buildTotal, data.buyTotal)) * 100;
      if (costDiffPct > 30) score += 15;
      else if (costDiffPct > 15) score += 10;
      else score -= 10;
      
      if (data.teamCapability === "high") score += 10;
      else if (data.teamCapability === "low") score -= 15;
      break;

    case "internal_vs_external":
      const qualityDiff = data.internalErrorRate - data.externalErrorRate;
      if (qualityDiff > 1.5) score += 10;
      if (data.externalDays < data.internalDays - 2) score += 10;
      if (data.knowledgeRisk === "high") score -= 15;
      break;

    case "hire_vs_automate":
      if (data.breakeven < 12) score += 15;
      else if (data.breakeven < 24) score += 10;
      if (data.automationPct > 75) score += 10;
      else if (data.automationPct < 50) score -= 10;
      break;

    case "capital_allocation":
      if (data.runway > 6) score += 10;
      else if (data.runway < 3) score -= 20;
      break;

    case "risk":
      if (data.overall > 7) score += 10;
      else if (data.overall < 4) score += 15;
      break;
  }

  return Math.min(95, Math.max(40, score));
};

const generateConfidenceFactors = (type: DecisionType, data: any): ConfidenceFactor[] => {
  const factors: ConfidenceFactor[] = [];

  switch (type) {
    case "investment":
      factors.push({
        factor: "NPV",
        status: data.npv > 0 ? "positive" : "negative",
        impact: "high",
        detail: `NPV of ₹${(data.npv / 100000).toFixed(1)}L ${data.npv > 0 ? 'supports' : 'argues against'} investment`
      });
      
      factors.push({
        factor: "IRR vs Hurdle Rate",
        status: data.irr > data.hurdleRate ? "positive" : "negative",
        impact: "high",
        detail: `IRR ${data.irr}% ${data.irr > data.hurdleRate ? 'exceeds' : 'below'} ${data.hurdleRate}% hurdle`
      });
      
      factors.push({
        factor: "Payback Period",
        status: data.payback < 3 ? "positive" : data.payback < 5 ? "neutral" : "negative",
        impact: "medium",
        detail: `${data.payback} year payback is ${data.payback < 3 ? 'excellent' : data.payback < 5 ? 'acceptable' : 'concerning'}`
      });
      
      if (data.cashPosition < data.investment * 0.5) {
        factors.push({
          factor: "Cash Position",
          status: "negative",
          impact: "high",
          detail: `Cash position weak relative to investment size`
        });
      }
      break;

    case "build_vs_buy":
      const costSavings = data.buyTotal - data.buildTotal;
      factors.push({
        factor: "5-Year Cost Comparison",
        status: costSavings > 0 ? "positive" : "negative",
        impact: "high",
        detail: `Build ${costSavings > 0 ? 'saves' : 'costs'} ₹${Math.abs(costSavings / 100000).toFixed(1)}L over 5 years`
      });
      
      factors.push({
        factor: "Time to Value",
        status: data.buildTimeline > data.buyTimeline * 2 ? "negative" : "neutral",
        impact: "medium",
        detail: `${data.buildTimeline} months build vs ${data.buyTimeline} months buy`
      });
      break;

    case "hire_vs_automate":
      factors.push({
        factor: "Break-even Period",
        status: data.breakeven < 12 ? "positive" : data.breakeven < 24 ? "neutral" : "negative",
        impact: "high",
        detail: `${data.breakeven} month break-even ${data.breakeven < 12 ? 'is excellent' : data.breakeven < 24 ? 'is acceptable' : 'is long'}`
      });
      
      factors.push({
        factor: "5-Year Savings",
        status: data.fiveYearSaving > 0 ? "positive" : "negative",
        impact: "high",
        detail: `₹${(data.fiveYearSaving / 100000).toFixed(1)}L saved over 5 years with automation`
      });
      break;
  }

  return factors;
};

const extractOutcome = (response: string, type: DecisionType): DecisionOutcome => {
  const upperResponse = response.toUpperCase();
  
  if (upperResponse.includes("APPROVE") || upperResponse.includes("RECOMMEND APPROVAL")) {
    return "approve";
  }
  if (upperResponse.includes("CONDITIONAL")) {
    return "conditional";
  }
  if (upperResponse.includes("REJECT") || upperResponse.includes("NOT RECOMMEND")) {
    return "reject";
  }
  if (upperResponse.includes("HYBRID") || upperResponse.includes("COMBINATION")) {
    return "hybrid";
  }
  if (upperResponse.includes("BUILD") && type === "build_vs_buy") {
    return "build";
  }
  if (upperResponse.includes("BUY") && type === "build_vs_buy") {
    return "buy";
  }
  if (upperResponse.includes("AUTOMATE") && type === "hire_vs_automate") {
    return "automate";
  }
  if (upperResponse.includes("HIRE") && type === "hire_vs_automate") {
    return "hire";
  }
  if (upperResponse.includes("INTERNAL") && type === "internal_vs_external") {
    return "internal";
  }
  if (upperResponse.includes("EXTERNAL") && type === "internal_vs_external") {
    return "external";
  }
  
  return "review";
};

// Investment calculations
export const calculateInvestmentMetrics = (
  investment: number,
  annualReturns: number,
  projectLife: number,
  discountRate: number
) => {
  // NPV calculation
  let npv = -investment;
  for (let year = 1; year <= projectLife; year++) {
    npv += annualReturns / Math.pow(1 + discountRate / 100, year);
  }

  // IRR calculation (simplified Newton-Raphson method)
  let irr = discountRate;
  for (let i = 0; i < 20; i++) {
    let npvAtIRR = -investment;
    let derivative = 0;
    
    for (let year = 1; year <= projectLife; year++) {
      const factor = Math.pow(1 + irr / 100, year);
      npvAtIRR += annualReturns / factor;
      derivative -= year * annualReturns / (factor * (1 + irr / 100));
    }
    
    if (Math.abs(npvAtIRR) < 0.01) break;
    irr = irr - npvAtIRR / derivative * 100;
  }

  // Payback period
  let cumulativeCashFlow = -investment;
  let payback = 0;
  for (let year = 1; year <= projectLife; year++) {
    cumulativeCashFlow += annualReturns;
    if (cumulativeCashFlow >= 0) {
      payback = year - 1 + (investment - (cumulativeCashFlow - annualReturns)) / annualReturns;
      break;
    }
  }
  if (payback === 0) payback = projectLife;

  // ROI
  const totalReturns = annualReturns * projectLife;
  const roi = ((totalReturns - investment) / investment) * 100;

  // Risk score (0-10 scale)
  let riskScore = 5; // base
  if (payback > 5) riskScore += 2;
  if (irr < discountRate) riskScore += 2;
  if (npv < 0) riskScore += 3;
  riskScore = Math.min(10, riskScore);

  return {
    npv: Math.round(npv),
    irr: Math.round(irr * 10) / 10,
    payback: Math.round(payback * 10) / 10,
    roi: Math.round(roi * 10) / 10,
    riskScore: Math.round(riskScore * 10) / 10
  };
};

// Build vs Buy calculations
export const calculateBuildVsBuyMetrics = (buildData: any, buyData: any, years: number = 5) => {
  const buildTotal = buildData.buildCost + (buildData.buildMaintenance * years) + 
                     (buildData.teamCost || 0) * years + (buildData.opportunityCost || 0);
  
  const buyTotal = (buyData.buyCost * years) + buyData.buyImplementation + 
                   (buyData.customizationCost || 0) + (buyData.supportCost || 0);

  const buildScore = calculateBuildScore(buildData, buyData);
  const buyScore = calculateBuyScore(buildData, buyData);

  return {
    buildTotal,
    buyTotal,
    savings: buyTotal - buildTotal,
    buildScore,
    buyScore,
    recommendation: buildScore > buyScore ? "build" : "buy"
  };
};

const calculateBuildScore = (buildData: any, buyData: any): number => {
  let score = 50;
  
  // Cost advantage
  const buildTotal = buildData.buildCost + (buildData.buildMaintenance * 5);
  const buyTotal = (buyData.buyCost * 5) + buyData.buyImplementation;
  if (buildTotal < buyTotal * 0.7) score += 20;
  else if (buildTotal < buyTotal) score += 10;
  else score -= 10;
  
  // Customization
  if (buildData.customization === "full") score += 15;
  
  // IP ownership
  score += 10;
  
  // Time to value (penalty)
  if (buildData.buildTimeline > 12) score -= 10;
  
  return Math.min(100, Math.max(0, score));
};

const calculateBuyScore = (buildData: any, buyData: any): number => {
  let score = 50;
  
  // Time to value advantage
  if (buyData.buyTimeline < 6) score += 15;
  
  // Lower implementation risk
  score += 10;
  
  // Maintenance handled by vendor
  score += 10;
  
  // Vendor lock-in penalty
  if (buyData.vendorLockIn === "high") score -= 15;
  
  // Cost disadvantage
  const buildTotal = buildData.buildCost + (buildData.buildMaintenance * 5);
  const buyTotal = (buyData.buyCost * 5) + buyData.buyImplementation;
  if (buyTotal > buildTotal * 1.5) score -= 15;
  
  return Math.min(100, Math.max(0, score));
};
