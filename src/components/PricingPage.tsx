import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Sparkles, Check, Zap, Shield, Rocket, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// @ts-ignore
import PaystackPop from '@paystack/inline-js';
import { PricingService, PricingPlan, DEFAULT_PRICING_PLANS } from '../services/pricingConfig';

export default function PricingPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [transactionRef, setTransactionRef] = useState('');
  const [plans, setPlans] = useState<PricingPlan[]>(DEFAULT_PRICING_PLANS);
  const [dailyFreeSparks, setDailyFreeSparks] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = PricingService.subscribePricingConfig((config) => {
      if (config.plans && config.plans.length > 0) {
        setPlans(config.plans.filter(p => p.enabled !== false));
      }
    });

    let isMounted = true;
    const fetchPolicy = async () => {
      try {
        const res = await fetch('/api/system/config/evaluation_policy');
        if (res.ok && isMounted) {
          const json = await res.json();
          const val = json.data?.dailyFreeSparks;
          setDailyFreeSparks(typeof val === 'number' && val > 0 ? val : null);
        }
      } catch {
        if (isMounted) setDailyFreeSparks(null);
      }
    };

    fetchPolicy();
    const interval = setInterval(fetchPolicy, 60000);
    const onFocus = () => { fetchPolicy(); };
    window.addEventListener('focus', onFocus);

    return () => {
      isMounted = false;
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handlePayment = async (plan: any) => {
    if (!user) {
      alert('Please sign in to subscribe!');
      return;
    }

    setLoading(true);
    setSelectedPlan(plan);

    try {
      // 1. Fetch the public key from the server (more robust than build-time env)
      const configResponse = await fetch('/api/config/paystack');
      if (!configResponse.ok) {
        throw new Error('Could not fetch payment configuration from server');
      }
      const { publicKey } = await configResponse.json();

      if (!publicKey) {
        throw new Error('Payment gateway key is missing on the server');
      }

      // 2. Initialize Paystack
      const paystack = new PaystackPop();
      
      paystack.newTransaction({
        key: publicKey,
        email: user.email,
        amount: plan.price * 100,
        metadata: { 
          userId: user.uid, 
          planType: plan.id,
          referredBy: profile?.referredBy || null
        },
        onSuccess: async (transaction: any) => {
          try {
            const response = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                reference: transaction.reference
              }),
            });
            if (!response.ok) throw new Error('Verification failed');
            setTransactionRef(transaction.reference);
            setShowSuccessModal(true);
          } catch (error) {
            console.error("Payment verification error:", error);
            alert("Payment successful, but verification failed. Please contact support with your reference: " + transaction.reference);
          } finally {
            setLoading(false);
          }
        },
        onCancel: () => {
          setLoading(false);
          setSelectedPlan(null);
        }
      });
    } catch (error: any) {
      console.error("Paystack initialization error:", error);
      alert(error.message || "Failed to initialize payment gateway. Please try again later.");
      setLoading(false);
      setSelectedPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-4 sm:p-8 lg:p-12 pb-24 transition-colors">
      <div className="max-w-6xl mx-auto space-y-16">
        <div className="text-center space-y-4">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-slate-900 dark:text-white tracking-tight">
            Invest in Your <span className="text-emerald-500">Grades</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Get the AI Sparks you need to crush every course this semester, no matter your major. Simple, affordable pricing for every student.
          </p>
        </div>

        <div className="bg-emerald-500 text-white rounded-3xl p-8 text-center shadow-xl shadow-emerald-500/20 mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4">Why Upgrade?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-bold text-xl mb-2">24/7 AI Tutoring</h3>
              <p className="text-emerald-50">Get instant, personalized help with any topic, 24/7.</p>
            </div>
            <div>
              <h3 className="font-bold text-xl mb-2">Mastery Tools</h3>
              <p className="text-emerald-50">Unlock advanced analytics and concept maps to visualize your progress.</p>
            </div>
            <div>
              <h3 className="font-bold text-xl mb-2">Exam Readiness</h3>
              <p className="text-emerald-50">Predict your exam performance with our advanced AI models.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {plans.map((plan) => (
            <motion.div 
              key={plan.id}
              whileHover={{ y: -8 }}
              className={`relative bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-sm border transition-all duration-300 ${
                plan.popular 
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-xl' 
                  : 'border-slate-200 dark:border-zinc-800 hover:shadow-lg'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg">
                  Most Popular
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">₦{plan.price.toLocaleString()}</span>
                    <span className="text-slate-500 dark:text-zinc-400 font-medium">/ {plan.duration}</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    <Zap size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{plan.sparks} Sparks</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium">AI assistance credits</p>
                  </div>
                </div>

                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-slate-600 dark:text-zinc-400">
                      <Check size={16} className="text-emerald-500 shrink-0" strokeWidth={3} />
                      <span className="text-sm font-medium">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePayment(plan)}
                  disabled={loading}
                  className={`w-full py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${
                    plan.popular 
                      ? 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/20' 
                      : 'bg-slate-900 dark:bg-white dark:text-zinc-900 hover:bg-slate-800 dark:hover:bg-zinc-200'
                  }`}
                >
                  {loading && selectedPlan?.id === plan.id ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>Choose {plan.name} <Rocket size={18} /></>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 flex items-start gap-6 shadow-sm">
            <div className="bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-full text-emerald-600 dark:text-emerald-400 shrink-0">
              <Zap size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">How Sparks Work</h3>
              <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed">
                Sparks fuel UniAce AI. Costs are dynamic based on query complexity. Standard queries start at ~2 Sparks; Deep Analysis starts at ~15 Sparks.
                {dailyFreeSparks !== null && dailyFreeSparks > 0
                  ? ` Daily allowance: Free users receive ${dailyFreeSparks} Sparks daily!`
                  : ''}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 flex items-start gap-6 shadow-sm">
            <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-full text-blue-600 dark:text-blue-400 shrink-0">
              <Shield size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Secure Payments</h3>
              <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed">
                Processed securely via Paystack. We accept Cards, Bank Transfer, and USSD. Your payment data is fully encrypted and safe.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
