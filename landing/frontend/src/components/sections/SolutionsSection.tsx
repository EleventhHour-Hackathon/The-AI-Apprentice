import React from "react";

interface Solution {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  benefits: string[];
}

interface SolutionsSectionProps {
  solutions: Solution[];
}

export const SolutionsSection: React.FC<SolutionsSectionProps> = ({
  solutions,
}) => {
  return (
    <section className="relative min-h-screen py-16 flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-white overflow-hidden">
      {/* Positive decorative elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        {/* Top right success arc */}
        <svg
          className="absolute top-16 right-8 w-32 h-32 opacity-15"
          viewBox="0 0 128 128"
        >
          <path
            d="M20,20 Q108,20 108,108"
            stroke="#488AB5"
            strokeWidth="2"
            fill="none"
          />
          <circle cx="108" cy="108" r="4" fill="#488AB5" opacity="0.6" />
        </svg>

        {/* Bottom left upward arrow pattern */}
        <div className="absolute bottom-20 left-8">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            className="text-[#488AB5]/30"
          >
            <path
              d="M7 14L12 9L17 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            className="text-[#488AB5]/20 mt-2 ml-2"
          >
            <path
              d="M7 14L12 9L17 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>

        {/* Center success pattern */}
        <div className="absolute top-1/2 right-1/4 transform -translate-y-1/2">
          <div className="w-2 h-2 bg-[#488AB5]/40 rounded-full"></div>
          <div className="w-1.5 h-1.5 bg-[#488AB5]/30 rounded-full mt-3 ml-3"></div>
          <div className="w-1 h-1 bg-[#488AB5]/35 rounded-full mt-2 -ml-1"></div>
        </div>
      </div>

      <div className="w-full max-w-[65%] mx-auto px-4 sm:px-6 relative z-10">
        <div className="text-center mb-10 sm:mb-20">
          <h2 className="solutions-title text-2xl sm:text-3xl md:text-4xl text-gray-900 mb-4 sm:mb-8">
            Transforming{" "}
            <span className="text-[#488AB5] font-bold">Talent Discovery</span>
          </h2>
          <p className="text-base sm:text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Empowering organizations with intelligent solutions that
            revolutionize how you find, assess, and hire exceptional talent.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 md:gap-12">
          {solutions.map((solution, _) => (
            <div
              key={solution.id}
              className="solution-card bg-white/90 backdrop-blur-lg p-8 sm:p-12 lg:p-16 rounded-2xl border border-gray-200 text-center hover:bg-white hover:shadow-xl hover:border-[#488AB5]/30 transition-all duration-500 shadow-lg group"
            >
              <div className="text-2xl mb-6 transform group-hover:scale-110 transition-transform duration-300">
                {solution.icon}
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4 group-hover:text-[#488AB5] transition-colors duration-300">
                {solution.title}
              </h3>
              <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-6">
                {solution.description}
              </p>
              <div className="space-y-2">
                {solution.benefits.map((benefit, benefitIndex) => (
                  <div
                    key={benefitIndex}
                    className="flex items-center justify-center text-xs sm:text-sm text-[#488AB5] font-medium"
                  >
                    <svg
                      className="w-4 h-4 mr-2 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {benefit}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
