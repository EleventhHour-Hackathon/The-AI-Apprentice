import { Button } from "@nextui-org/react";
import { useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { Check } from "lucide-react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

// @ts-expect-error - This is a workaround to fix the type error
import "@fontsource/plus-jakarta-sans";

import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useGSAP } from "@gsap/react";

// Register GSAP plugins
gsap.registerPlugin(
  ScrollTrigger,
  SplitText,
  ScrambleTextPlugin,
  ScrollSmoother
);

export const LandingPage = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const aiInterviewsRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const pricingRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  const [isNavbarVisible, setIsNavbarVisible] = useState(false);
  const [aiInterviewsAnimated, setAiInterviewsAnimated] = useState(false);

  const { contextSafe } = useGSAP(
    () => {
      // COMMENTED OUT: Set up ScrollSmoother for butter smooth scrolling
      // const smoother = ScrollSmoother.create({
      //   wrapper: containerRef.current,
      //   content: containerRef.current?.querySelector(
      //     ".smooth-content"
      //   ) as HTMLElement,
      //   smooth: 1.2, // Smoothness factor (1-2 is ideal for butter smooth)
      //   effects: true, // Enable smooth effects
      //   normalizeScroll: true, // Normalize scroll across devices
      //   ignoreMobileResize: true, // Better mobile performance
      //   smoothTouch: 0.1, // Touch device smoothness
      //   ease: "power2.out", // Smooth easing
      // });

      // COMMENTED OUT: Set up smooth scroll behavior
      // document.body.style.overflow = "hidden"; // Hide default scrollbar
      // document.body.style.overflowX = "hidden";
      // document.documentElement.style.scrollBehavior = "auto"; // Disable native smooth scroll

      // Reset default margins/padding
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.documentElement.style.margin = "0";
      document.documentElement.style.padding = "0";

      // Optimize scroll performance
      document.body.style.touchAction = "manipulation";
      (
        document.body.style as CSSStyleDeclaration & {
          webkitOverflowScrolling?: string;
        }
      ).webkitOverflowScrolling = "touch";

      // Global ScrollTrigger performance optimizations
      ScrollTrigger.config({
        autoRefreshEvents: "visibilitychange,DOMContentLoaded,load",
        ignoreMobileResize: true,
      });

      // Batch ScrollTrigger updates for better performance
      ScrollTrigger.batch(".problem-card, .stat-card", {
        onEnter: (elements) => {
          gsap.set(elements, { willChange: "transform, opacity, filter" });
        },
        onLeave: (elements) => {
          gsap.set(elements, { willChange: "auto" });
        },
      });

      // Add CSS to support ScrollSmoother and optimize performance
      const style = document.createElement("style");
      style.setAttribute("data-gsap-injected", "true");
      style.textContent = `
        /* COMMENTED OUT: ScrollSmoother Setup - Not needed without ScrollSmoother */
        /* .smooth-wrapper {
          overflow: hidden;
          position: fixed;
          height: 100vh;
          width: 100%;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
        }
        
        .smooth-content {
          min-height: 100vh;
          width: 100%;
        } */
        
        .pin-spacer {
          pointer-events: none !important;
        }
        .gsap-active * {
          transition: none !important;
        }
        /* Advanced Performance Optimizations */
        * {
          box-sizing: border-box;
        }
        
        /* GPU Acceleration for all animated elements */
        .hero-title, .hero-subtitle, .hero-description, .hero-cta,
        .ai-interviews-title, .ai-interviews-content, .ai-interviews-image,
        .problem-title, .problem-card, .floating-header,
        .video-container, .stat-card, .cta-title, .cta-subtitle {
          transform: translateZ(0);
          backface-visibility: hidden;
          perspective: 1000px;
          will-change: transform, opacity, filter;
        }
        
        
        /* Optimize scrolling performance */
        html {
          scroll-behavior: auto !important;
        }
        
        body {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeSpeed;
          overflow: auto;
          margin: 0;
          padding: 0;
        }
        
        /* Reduce repaints and reflows */
        .video-container iframe {
          transform: translateZ(0);
          contain: layout style paint;
        }
        
        /* Optimize text rendering */
        .stat-number {
          font-feature-settings: "tnum";
          font-variant-numeric: tabular-nums;
          contain: layout style;
        }
        
        /* Optimize blur effects */
        .floating-header, .problem-card {
          contain: layout style paint;
        }
        
        /* Prevent layout thrashing */
        img, video, iframe {
          max-width: 100%;
          height: auto;
          contain: layout;
        }
        
        /* Optimize animations */
        @media (prefers-reduced-motion: no-preference) {
          .hero-title, .problem-card, .stat-card {
            animation-fill-mode: both;
          }
        }
        
        /* Disable animations for users who prefer reduced motion */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
        /* Light text selection color */
        ::selection {
          background-color: rgba(72, 138, 181, 0.3) !important;
          color: inherit !important;
        }
        ::-moz-selection {
          background-color: rgba(72, 138, 181, 0.3) !important;
          color: inherit !important;
        }
      `;
      document.head.appendChild(style);

      // Hero section animations (simplified to ensure visibility)
      // Set initial visibility for all hero elements
      gsap.set(
        [".hero-title", ".hero-subtitle", ".hero-description", ".hero-cta"],
        {
          opacity: 1,
          visibility: "visible",
        }
      );

      // Hero entrance animation using clean character reveal
      const heroTitle = document.querySelector(".hero-title");
      if (heroTitle) {
        // Split the title into characters for clean animation
        const heroSplit = new SplitText(heroTitle, { type: "chars" });

        // Apply primary brand color to all characters - simple and clean
        heroSplit.chars.forEach((char: Element) => {
          gsap.set(char, {
            color: "#488AB5", // Primary brand color
            textShadow: "0 0 20px rgba(72, 138, 181, 0.3)",
            display: "inline-block",
          });
        });

        // Set initial state for characters (same as cognitive "precision" animation)
        gsap.set(heroSplit.chars, {
          opacity: 0,
          scale: 1.1,
          rotation: "random(-5, 5)",
        });

        const heroTimeline = gsap.timeline();

        heroTimeline.fromTo(
          heroSplit.chars,
          {
            opacity: 0,
            scale: 1.1,
            rotation: "random(-5, 5)",
          },
          {
            opacity: 1,
            scale: 1,
            rotation: 0,
            duration: 0.5,
            ease: "power4.out",
            stagger: 0.05,
            onComplete: () => {
              // Move SIVERA up after precision reveal
              gsap.to(heroTitle, {
                y: -60,
                duration: 0.8,
                ease: "power3.out",
              });
            },
          }
        );

        // Continue with the rest of the hero animations after title moves up
        heroTimeline
          .fromTo(
            ".hero-subtitle",
            {
              opacity: 0,
              y: 30,
            },
            {
              opacity: 1,
              y: 0,
              duration: 0.8,
              ease: "power3.out",
            },
            "+=0.2"
          )
          .to(
            ".brush-stroke-1",
            {
              strokeDashoffset: 0,
              duration: 1.2,
              ease: "power2.out",
            },
            "-=0.3"
          )
          .fromTo(
            ".hero-description",
            {
              opacity: 0,
              y: 20,
            },
            {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: "power2.out",
            },
            "-=0.4"
          )
          .fromTo(
            ".hero-cta",
            {
              opacity: 0,
              y: 40,
              scale: 0.9,
            },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.8,
              ease: "back.out(1.7)",
            },
            "-=0.2"
          );
      }

      // Problem section with pinning and sequential card reveals
      gsap.set(".problem-title", {
        opacity: 1,
        visibility: "visible",
      });

      // Initially hide the cards with blur
      gsap.set(".problem-card", {
        opacity: 0,
        filter: "blur(20px)",
        scale: 1,
      });

      // Create optimized animation for sequential card reveals
      gsap.to(".problem-card", {
        opacity: 1,
        filter: "blur(0px)",
        duration: 0.8, // Reduced for better performance
        ease: "power2.out",
        stagger: 0.2, // Reduced stagger for faster reveal
        scrollTrigger: {
          trigger: problemRef.current,
          start: "top 80%",
          once: true,
          fastScrollEnd: true, // Optimize for fast scrolling
          preventOverlaps: true, // Prevent animation conflicts
        },
      });

      // AI Interviews section entrance animation - optimized for performance
      ScrollTrigger.create({
        trigger: aiInterviewsRef.current,
        start: "top 85%",
        end: "bottom 15%",
        once: true,
        fastScrollEnd: true,
        preventOverlaps: true,
        onEnter: () => {
          // Prevent re-animation if already animated
          if (aiInterviewsAnimated) return;

          const aiInterviewsContent = aiInterviewsRef.current?.querySelector(
            ".ai-interviews-content"
          );
          const aiInterviewsImage = aiInterviewsRef.current?.querySelector(
            ".ai-interviews-image"
          );

          if (aiInterviewsContent && aiInterviewsImage) {
            // Mark as animated to prevent re-triggering
            setAiInterviewsAnimated(true);
            // Use will-change to optimize for animation
            gsap.set([aiInterviewsContent, aiInterviewsImage], {
              willChange: "transform, opacity, filter",
            });

            const tl = gsap.timeline();

            tl.fromTo(
              aiInterviewsImage,
              {
                opacity: 0,
                scale: 0.95,
                y: -30,
                filter: "blur(10px)",
              },
              {
                opacity: 1,
                scale: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 1.2,
                ease: "power2.out",
              }
            ).fromTo(
              aiInterviewsContent,
              {
                opacity: 0,
                y: 30,
              },
              {
                opacity: 1,
                y: 0,
                duration: 0.8,
                ease: "power2.out",
                onComplete: () => {
                  // Remove will-change after animation
                  gsap.set([aiInterviewsContent, aiInterviewsImage], {
                    willChange: "auto",
                  });
                },
              },
              "-=0.4"
            );
          }
        },
      });

      // Video section entrance animation - optimized for performance
      ScrollTrigger.create({
        trigger: videoRef.current,
        start: "top 70%",
        once: true,
        fastScrollEnd: true,
        onEnter: () => {
          const videoContainer =
            videoRef.current?.querySelector(".video-container");

          if (videoContainer) {
            // Use will-change to optimize for animation
            gsap.set(videoContainer, { willChange: "transform, opacity" });

            gsap.fromTo(
              videoContainer,
              {
                opacity: 0,
                scale: 0.9,
                y: 30,
                transformOrigin: "center center",
              },
              {
                opacity: 1,
                scale: 1,
                y: 0,
                duration: 1.0,
                ease: "power2.out",
                onComplete: () => {
                  // Remove will-change after animation
                  gsap.set(videoContainer, { willChange: "auto" });
                },
              }
            );
          }
        },
      });

      // Stats section with counter animations - optimized for performance
      ScrollTrigger.create({
        trigger: statsRef.current,
        start: "top 70%",
        once: true,
        fastScrollEnd: true,
        onEnter: () => {
          const statsCards = gsap.utils.toArray(".stat-card");
          const statsNumbers = gsap.utils.toArray(".stat-number");

          // Optimize cards animation - remove expensive 3D transforms
          gsap.set(statsCards, { willChange: "transform, opacity" });
          gsap.fromTo(
            statsCards,
            {
              opacity: 0,
              y: 40,
              scale: 0.95,
            },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.6,
              ease: "power2.out",
              stagger: 0.08,
              onComplete: () => {
                gsap.set(statsCards, { willChange: "auto" });
              },
            }
          );

          // Optimize counter animations with better performance
          statsNumbers.forEach((number: unknown, index) => {
            const element = number as HTMLElement;
            const finalValue = parseInt(
              element.getAttribute("data-value") || "0"
            );
            let currentValue = 0;

            gsap.to(
              {},
              {
                duration: 1.2,
                ease: "power2.out",
                delay: index * 0.1,
                onUpdate: function () {
                  const progress = this.progress();
                  const newValue = Math.round(
                    currentValue + (finalValue - currentValue) * progress
                  );
                  if (element.textContent !== newValue.toString()) {
                    element.textContent = newValue.toString();
                  }
                  currentValue = newValue;
                },
              }
            );
          });
        },
      });

      // Pricing section with morphing cards
      ScrollTrigger.create({
        trigger: pricingRef.current,
        start: "top 90%",
        once: true,
        fastScrollEnd: true,
        onEnter: () => {
          const pricingCards = gsap.utils.toArray(".pricing-card");
          const pricingTitle = document.querySelector(".pricing-title");

          // Professional fade-up animation for the title
          gsap
            .timeline()
            .fromTo(
              pricingTitle,
              {
                opacity: 0,
                y: 30,
                filter: "blur(5px)",
              },
              {
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 1.0,
                ease: "power2.out",
              }
            )
            .fromTo(
              pricingCards,
              {
                opacity: 0,
                y: 80,
                rotationY: 30,
                transformOrigin: "center bottom",
              },
              {
                opacity: 1,
                y: 0,
                rotationY: 0,
                duration: 0.4,
                filter: "blur(0px)",
                ease: "power2.out",
                stagger: 0.05,
              },
              "-=0.3"
            );
        },
      });

      // Start circle animation when almost at CTA section
      ScrollTrigger.create({
        trigger: ctaRef.current,
        start: "top 120%", // Start earlier - when section is still below viewport
        once: true,
        fastScrollEnd: true,
        onEnter: () => {
          // Start the sequential circle animation
          const circles = [
            ".cta-circle-1",
            ".cta-circle-2",
            ".cta-circle-3",
            ".cta-circle-4",
            ".cta-circle-5",
            ".cta-circle-6",
            ".cta-circle-7",
          ];

          // Create repeating timeline for sequential circle animation
          const circleTimeline = gsap.timeline({
            repeat: -1,
            repeatDelay: 0.3,
          });

          circles.forEach((circle, index) => {
            circleTimeline.to(
              circle,
              {
                scale: 1.3,
                opacity: 0.9,
                duration: 1.2,
                ease: "power2.out",
                yoyo: true,
                repeat: 1,
              },
              index * 0.4
            ); // Stagger each circle by 0.4 seconds
          });
        },
      });

      // CTA section with smooth word-by-word entrance
      ScrollTrigger.create({
        trigger: ctaRef.current,
        start: "top 80%",
        once: true,
        fastScrollEnd: true,
        onEnter: () => {
          // Professional blur reveal animation
          gsap
            .timeline()
            .fromTo(
              ".cta-title",
              {
                opacity: 0,
                y: 30,
                filter: "blur(10px)",
              },
              {
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 1.0,
                ease: "power2.out",
              }
            )
            .fromTo(
              ".cta-subtitle",
              {
                opacity: 0,
                y: 20,
                filter: "blur(8px)",
              },
              {
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 0.8,
                ease: "power2.out",
              },
              "-=0.6"
            )
            .fromTo(
              ".cta-buttons",
              {
                opacity: 0,
                scale: 0.8,
                y: 40,
              },
              {
                opacity: 1,
                scale: 1,
                y: 0,
                duration: 1.2,
                ease: "back.out(1.7)",
                onComplete: () => {
                  // Enable hover animations only after initial reveal
                  const ctaButton = document.querySelector(".cta-button");
                  if (ctaButton) {
                    ctaButton.classList.add("hover-enabled");
                  }
                },
              },
              "-=0.3"
            );
        },
      });

      // Parallax effects with better performance
      gsap.utils.toArray(".parallax-element").forEach((element: unknown) => {
        const el = element as HTMLElement;
        gsap.to(el, {
          yPercent: -30,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
            fastScrollEnd: true,
          },
        });
      });

      // Optimize ScrollTrigger sorting and refresh
      ScrollTrigger.sort();

      // Enhanced refresh strategy to handle layout changes
      const refreshScrollTrigger = () => {
        ScrollTrigger.refresh();
      };

      // Initial refresh after short delay
      gsap.delayedCall(0.1, refreshScrollTrigger);

      // Performance optimizations
      const optimizeForDevice = () => {
        const isLowEndDevice =
          navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const isMobile = window.innerWidth < 768;

        if (isLowEndDevice || isMobile) {
          // Reduce animation complexity for low-end devices
          ScrollTrigger.getAll().forEach((trigger) => {
            if (trigger.animation) {
              trigger.animation.duration(trigger.animation.duration() * 0.7);
            }
          });

          // Reduce blur effects on mobile
          gsap.set(".floating-header, .problem-card", {
            backdropFilter: isMobile ? "blur(8px)" : "blur(16px)",
          });
        }
      };

      // Apply optimizations
      optimizeForDevice();

      // Refresh after images and fonts load
      gsap.delayedCall(1, () => {
        refreshScrollTrigger();
        optimizeForDevice(); // Re-optimize after load
      });

      // Handle window resize with debouncing and performance optimization
      let resizeTimeout: NodeJS.Timeout;
      const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          refreshScrollTrigger();
          optimizeForDevice();
        }, 250);
      };
      window.addEventListener("resize", handleResize);

      // Navbar visibility trigger - when Elegant Section Divider reaches top
      ScrollTrigger.create({
        trigger: ".elegant-section-divider",
        start: "top top",
        end: "bottom top",
        onEnter: () => setIsNavbarVisible(true),
        onEnterBack: () => setIsNavbarVisible(true),
        onLeaveBack: () => setIsNavbarVisible(false),
      });

      // Water-like banner background animation
      if (bannerRef.current) {
        const banner = bannerRef.current;

        // Create a relaxing water-like movement for the banner
        const bannerTimeline = gsap.timeline({ repeat: -1 });

        bannerTimeline
          .to(banner, {
            backgroundPosition: "55% 45%",
            duration: 10,
            ease: "sine.inOut",
          })
          .to(banner, {
            backgroundPosition: "45% 55%",
            duration: 13,
            ease: "sine.inOut",
          })
          .to(banner, {
            backgroundPosition: "60% 40%",
            duration: 15,
            ease: "sine.inOut",
          })
          .to(banner, {
            backgroundPosition: "40% 60%",
            duration: 12,
            ease: "sine.inOut",
          })
          .to(banner, {
            backgroundPosition: "50% 50%",
            duration: 9,
            ease: "sine.inOut",
          });
      }

      // Cleanup function
      return () => {
        window.removeEventListener("resize", handleResize);
        // COMMENTED OUT: Kill ScrollSmoother instance
        // if (smoother) {
        //   smoother.kill();
        // }
        // Remove the injected CSS when component unmounts
        const injectedStyle = document.querySelector(
          "style[data-gsap-injected]"
        );
        if (injectedStyle) {
          injectedStyle.remove();
        }
      };
    },
    { scope: containerRef }
  );

  // Enhanced button interactions using contextSafe
  const handleButtonEnter = contextSafe((e: React.MouseEvent) => {
    // Only apply hover animation if the button has hover-enabled class
    if ((e.currentTarget as HTMLElement).classList.contains("hover-enabled")) {
      gsap.to(e.currentTarget, {
        scale: 1.05,
        y: -5,
        boxShadow: "0 20px 40px rgba(72, 138, 181, 0.3)",
        duration: 0.3,
        ease: "power2.out",
      });
    }
  });

  const handleButtonLeave = contextSafe((e: React.MouseEvent) => {
    // Only apply hover animation if the button has hover-enabled class
    if ((e.currentTarget as HTMLElement).classList.contains("hover-enabled")) {
      gsap.to(e.currentTarget, {
        scale: 1,
        y: 0,
        boxShadow: "0 10px 30px rgba(72, 138, 181, 0.2)",
        duration: 0.3,
        ease: "power2.out",
      });
    }
  });

  return (
    <div className="w-full tracking-tight font-sora">
      <Navbar isVisible={isNavbarVisible} />
      <div ref={containerRef} className="w-full bg-[#FAFAFB] text-gray-900">
        <div className="w-full bg-[#FAFAFB] text-gray-900">
          {/* Hero Section */}
          <section
            ref={heroRef}
            className="relative min-h-screen py-16 sm:py-0 flex flex-col sm:flex-row items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/50 to-slate-100 overflow-hidden"
          >
            {/* Minimalistic Background Banner */}
            <div
              ref={bannerRef}
              className="absolute inset-0 opacity-[0.1] bg-center bg-cover bg-no-repeat pointer-events-none blur-sm"
              style={{
                backgroundImage: 'url("/Banner.png")',
                transform: "scale(1.1)",
              }}
            />

            {/* Decorative Lines */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Right vertical line */}
              <div className="absolute top-1/4 right-16 w-px h-32 bg-gradient-to-b from-transparent via-[#488AB5]/30 to-transparent"></div>

              {/* Bottom left curved accent */}
              <svg
                className="absolute bottom-20 left-1/4 w-24 h-24 opacity-15"
                viewBox="0 0 96 96"
              >
                <circle
                  cx="48"
                  cy="48"
                  r="47"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                  strokeDasharray="10,5"
                />
              </svg>
            </div>
            <div className="w-full md:max-w-[70%] mx-auto px-6 text-center relative z-10">
              <h3
                className="hero-title text-[4rem] sm:text-[6rem] md:text-[7rem] lg:text-[10rem] xl:text-[12rem] font-kyiv font-black bg-gradient-to-r from-[#002B45] via-[#488AB5] to-[#002B45] bg-clip-text text-transparent mb-2 sm:mb-2 leading-none"
                style={{
                  opacity: 1,
                  visibility: "visible",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  letterSpacing: "0.05em",
                }}
              >
                SIVERA
              </h3>

              <p className="hero-subtitle text-lg sm:text-2xl md:text-3xl font-sora font-normal text-gray-800 mb-4 sm:mb-8 leading-tight">
                The Future of{" "}
                <span className="text-[#488AB5] font-medium relative inline-block pb-2">
                  Interviews
                  <svg
                    className="hero-underline absolute bottom-0 left-0 w-full h-4 overflow-visible"
                    viewBox="0 0 273 12"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient
                        id="brushGradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#488AB5" />
                        <stop offset="100%" stopColor="#002B45" />
                      </linearGradient>
                    </defs>
                    <path
                      className="brush-stroke-1"
                      d="M2,10 C40,10 70,12 100,12 C120,12 135,20 150,10 C165,0 185,25 205,10 C225,-5 250,20 280,10"
                      stroke="url(#brushGradient)"
                      strokeWidth="2.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity="0.45"
                      strokeDasharray="500"
                      strokeDashoffset="500"
                    />
                  </svg>
                </span>
              </p>

              <p className="hero-description text-sm sm:text-base font-work font-normal text-gray-600 mb-8 sm:mb-12 max-w-3xl mx-auto leading-relaxed px-4">
                Revolutionize your hiring process with AI-powered interviews
                that discover hidden talent, eliminate bias, and make
                data-driven decisions in minutes.
              </p>

              <div className="hero-cta flex flex-col sm:flex-row gap-4 sm:gap-8 justify-center items-center w-full px-3 sm:px-0">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white text-xs sm:text-sm md:text-md px-6 sm:px-8 md:px-10 py-4 sm:py-3 md:py-4 rounded-full shadow-2xl w-full sm:w-auto min-h-[56px] flex items-center justify-center font-work font-medium"
                  onMouseEnter={handleButtonEnter}
                  onMouseLeave={handleButtonLeave}
                  onClick={() =>
                    (window.location.href = "https://cal.com/gsnmithra/meet")
                  }
                >
                  Let's Talk
                </Button>
                <Button
                  size="lg"
                  className="border-3 border-[#488AB5] text-[#488AB5] text-xs sm:text-sm md:text-md px-6 sm:px-8 md:px-10 py-4 sm:py-3 md:py-4 rounded-full hover:bg-[#488AB5] hover:text-white transition-all duration-500 w-full sm:w-auto min-h-[56px] flex items-center justify-center bg-transparent font-work font-medium"
                  onMouseEnter={handleButtonEnter}
                  onMouseLeave={handleButtonLeave}
                  onClick={() =>
                    window.open(
                      "https://www.youtube.com/watch?v=qetjdjGMFOo",
                      "_blank"
                    )
                  }
                >
                  Watch Demo
                </Button>
              </div>
            </div>

            {/* Section Separator */}
            <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#488AB5]/30 to-transparent"></div>
          </section>

          {/* Elegant Section Divider */}
          <div className="elegant-section-divider relative py-8 bg-white">
            <div className="flex items-center justify-center">
              <div className="w-16 h-px bg-[#488AB5]/20"></div>
              <svg
                className="mx-4 w-6 h-6 text-[#488AB5]/40"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" />
              </svg>
              <div className="w-16 h-px bg-[#488AB5]/20"></div>
            </div>
          </div>

          {/* AI Interviews Section */}
          <section
            ref={aiInterviewsRef}
            className="relative min-h-screen py-16 sm:py-24 flex items-center justify-center bg-gradient-to-br from-white via-slate-50/30 to-blue-50/40 overflow-hidden"
          >
            {/* Unique AI-themed decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Floating minimal elements */}
              <div className="absolute top-1/4 right-1/4">
                <div className="w-1 h-8 bg-[#488AB5]/20 rounded-full transform rotate-45"></div>
                <div className="w-1 h-8 bg-[#488AB5]/20 rounded-full transform -rotate-45 absolute top-0 left-0"></div>
              </div>

              <div className="absolute bottom-1/3 left-1/3">
                <div className="w-2 h-2 border border-[#488AB5]/25 rounded-full"></div>
                <div className="w-1 h-1 bg-[#488AB5]/30 rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
              </div>
            </div>

            <div className="w-full h-full relative z-10 flex flex-col items-center justify-center">
              {/* Center Large Image */}
              <div className="ai-interviews-image flex items-center justify-center -mb-16">
                <div className="relative w-[70%]">
                  <img
                    src="/alice-interview-2.png"
                    alt="AI Interview Conversation Interface"
                    className="w-full h-auto"
                  />
                </div>
              </div>

              {/* Center Bottom Content */}
              <div className="ai-interviews-content text-center max-w-2xl px-6 relative">
                {/* Animated wavy lines behind title */}
                <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 w-screen pointer-events-none -z-1000">
                  <svg
                    className="w-full h-32 opacity-35"
                    viewBox="-100 0 1400 128"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <style>
                        {`
                          .wave1 {
                            animation: wave-flow-1 4s ease-in-out infinite, wave-thickness-1 3.2s ease-in-out infinite;
                          }
                          .wave2 {
                            animation: wave-flow-2 3.5s ease-in-out infinite, wave-thickness-2 2.8s ease-in-out infinite;
                            animation-delay: 0.5s, 0.8s;
                          }
                          .wave3 {
                            animation: wave-flow-3 4.5s ease-in-out infinite, wave-thickness-3 3.7s ease-in-out infinite;
                            animation-delay: 1s, 1.5s;
                          }
                          @keyframes wave-flow-1 {
                            0%, 100% { d: path('M-100,20 Q-40,-5 20,20 Q80,45 140,20 Q200,-5 260,20 Q320,45 380,20 Q440,-5 500,20 Q560,45 620,20 Q680,-5 740,20 Q800,45 860,20 Q920,-5 980,20 Q1040,45 1100,20 Q1160,-5 1220,20 Q1280,45 1400,20'); }
                            50% { d: path('M-100,20 Q-40,45 20,20 Q80,-5 140,20 Q200,45 260,20 Q320,-5 380,20 Q440,45 500,20 Q560,-5 620,20 Q680,45 740,20 Q800,-5 860,20 Q920,45 980,20 Q1040,-5 1100,20 Q1160,45 1220,20 Q1280,-5 1400,20'); }
                          }
                          @keyframes wave-flow-2 {
                            0%, 100% { d: path('M-114,48 Q-54,15 6,48 Q66,81 126,48 Q186,15 246,48 Q306,81 366,48 Q426,15 486,48 Q546,81 606,48 Q666,15 726,48 Q786,81 846,48 Q906,15 966,48 Q1026,81 1086,48 Q1146,15 1206,48 Q1266,81 1414,48'); }
                            50% { d: path('M-114,48 Q-54,81 6,48 Q66,15 126,48 Q186,81 246,48 Q306,15 366,48 Q426,81 486,48 Q546,15 606,48 Q666,81 726,48 Q786,15 846,48 Q906,81 966,48 Q1026,15 1086,48 Q1146,81 1206,48 Q1266,15 1414,48'); }
                          }
                          @keyframes wave-flow-3 {
                            0%, 100% { d: path('M-75,76 Q-15,35 45,76 Q105,117 165,76 Q225,35 285,76 Q345,117 405,76 Q465,35 525,76 Q585,117 645,76 Q705,35 765,76 Q825,117 885,76 Q945,35 1005,76 Q1065,117 1125,76 Q1185,35 1245,76 Q1305,117 1425,76'); }
                            50% { d: path('M-75,76 Q-15,117 45,76 Q105,35 165,76 Q225,117 285,76 Q345,35 405,76 Q465,117 525,76 Q585,35 645,76 Q705,117 765,76 Q825,35 885,76 Q945,117 1005,76 Q1065,35 1125,76 Q1185,117 1245,76 Q1305,35 1425,76'); }
                          }
                          @keyframes wave-thickness-1 {
                            0% { stroke-width: 4; }
                            33% { stroke-width: 2; }
                            66% { stroke-width: 3; }
                            100% { stroke-width: 4; }
                          }
                          @keyframes wave-thickness-2 {
                            0% { stroke-width: 2; }
                            40% { stroke-width: 4; }
                            80% { stroke-width: 2.5; }
                            100% { stroke-width: 2; }
                          }
                          @keyframes wave-thickness-3 {
                            0% { stroke-width: 3; }
                            25% { stroke-width: 4; }
                            50% { stroke-width: 2; }
                            75% { stroke-width: 3.5; }
                            100% { stroke-width: 3; }
                          }
                        `}
                      </style>
                    </defs>
                    <path
                      className="wave1"
                      d="M-100,20 Q-40,-5 20,20 Q80,45 140,20 Q200,-5 260,20 Q320,45 380,20 Q440,-5 500,20 Q560,45 620,20 Q680,-5 740,20 Q800,45 860,20 Q920,-5 980,20 Q1040,45 1100,20 Q1160,-5 1220,20 Q1280,45 1400,20"
                      stroke="#488AB5"
                      strokeWidth="4"
                      fill="none"
                      opacity="0.10"
                    />
                    <path
                      className="wave2"
                      d="M-114,48 Q-54,15 6,48 Q66,81 126,48 Q186,15 246,48 Q306,81 366,48 Q426,15 486,48 Q546,81 606,48 Q666,15 726,48 Q786,81 846,48 Q906,15 966,48 Q1026,81 1086,48 Q1146,15 1206,48 Q1266,81 1414,48"
                      stroke="#488AB5"
                      strokeWidth="2"
                      fill="none"
                      opacity="0.11"
                    />
                    <path
                      className="wave3"
                      d="M-75,76 Q-15,35 45,76 Q105,117 165,76 Q225,35 285,76 Q345,117 405,76 Q465,35 525,76 Q585,117 645,76 Q705,35 765,76 Q825,117 885,76 Q945,35 1005,76 Q1065,117 1125,76 Q1185,35 1245,76 Q1305,117 1425,76"
                      stroke="#488AB5"
                      strokeWidth="3"
                      fill="none"
                      opacity="0.12"
                    />
                  </svg>
                </div>

                <div className="relative z-10 -bottom-7">
                  <h2 className="ai-interviews-title text-sm sm:text-lg md:text-xl font-sora text-gray-900 mb-2 font-normal leading-tight relative z-10">
                    Most Realistic{" "}
                    <span className="text-[#488AB5] font-medium">
                      Conversational AI
                    </span>{" "}
                    Interviews
                  </h2>
                  <p className="text-xs sm:text-sm font-work text-gray-600 font-normal mb-6">
                    Human-like conversations powered by AI with perfect
                    interviewing knowledge and flawless skill assessment
                    techniques.
                  </p>

                  <div className="flex justify-center space-x-8">
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 border border-[#488AB5] rounded-full"></div>
                      <span className="text-sm font-work font-normal text-gray-700">
                        Human-like Conversations
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 border border-[#488AB5] rounded-full"></div>
                      <span className="text-sm font-work font-normal text-gray-700">
                        Perfect Interviewing Knowledge
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Stats Section - Measurable Excellence */}
          <section
            ref={statsRef}
            className="relative min-h-screen py-16 sm:py-24 flex items-center justify-center bg-gradient-to-br from-white via-blue-50/40 to-slate-50 overflow-hidden px-6 sm:px-16"
          >
            {/* Geometric background elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Large circle outline - hidden on mobile */}
              <svg
                className="absolute top-10 left-1/4 w-48 h-48 opacity-5 hidden sm:block"
                viewBox="0 0 192 192"
              >
                <circle
                  cx="96"
                  cy="96"
                  r="95"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>

              {/* Connecting lines - hidden on mobile */}
              <div className="absolute top-1/3 right-10 hidden sm:flex sm:flex-col sm:space-y-4">
                <div className="w-12 h-px bg-[#488AB5]/20"></div>
                <div className="w-8 h-px bg-[#488AB5]/30"></div>
                <div className="w-16 h-px bg-[#488AB5]/15"></div>
              </div>

              {/* Bottom corner accent - hidden on mobile */}
              <svg
                className="absolute bottom-10 right-16 w-20 h-20 opacity-15 hidden sm:block"
                viewBox="0 0 80 80"
              >
                <path
                  d="M10,70 L70,70 L70,10"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                />
                <circle cx="70" cy="10" r="2" fill="#488AB5" />
              </svg>

              {/* Mobile-only decorative elements */}
              <div className="sm:hidden">
                {/* Simple mobile background accent */}
                <div className="absolute top-20 right-8 w-16 h-16 border border-[#488AB5]/10 rounded-full"></div>
                <div className="absolute bottom-32 left-8 w-8 h-8 bg-[#488AB5]/5 rounded-full"></div>
              </div>
            </div>

            {/* Desktop Layout */}
            <div className="w-full max-w-[90%] mx-auto px-4 sm:px-6 relative z-10 hidden sm:block">
              {/* Title Section */}
              <div className="flex items-center justify-between">
                {/* Left side - Title */}
                <div className="flex-1 flex flex-col justify-center">
                  <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-sora font-medium text-gray-900 mb-4 -ml-[3px]">
                    Measurable{" "}
                    <span className="text-[#488AB5] font-medium">
                      Excellence
                    </span>
                  </h2>
                  <p className="text-xs md:text-sm font-work text-gray-700 max-w-xl font-normal leading-relaxed">
                    Revolutionary assessment capabilities that transform how you
                    evaluate talent
                  </p>
                </div>

                {/* Right side - Large Numbers */}
                <div className="flex-1 flex flex-col items-end space-y-8 mt-12">
                  {/* 70% Metric */}
                  <div className="text-right opacity-80">
                    <div className="text-9xl sm:text-[12rem] md:text-[14rem] lg:text-[16rem] font-bold text-[#488AB5] leading-none mb-4">
                      <span className="stat-number" data-value="70">
                        0
                      </span>
                      <span className="text-gray-600 text-[4rem] sm:text-[6rem] md:text-[8rem] lg:text-[10rem]">
                        %
                      </span>
                    </div>
                    <div className="text-right -mt-8">
                      <h3 className="text-sm sm:text-base md:text-lg font-sora font-medium text-gray-900 mb-2 uppercase tracking-wide">
                        Faster Evaluation
                      </h3>
                      <p className="text-xs md:text-sm font-work font-normal text-gray-600 max-w-md leading-relaxed ml-auto">
                        Dramatically accelerate your hiring process with
                        AI-powered interviews that scale effortlessly
                      </p>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-32 h-px bg-[#488AB5]/30"></div>

                  {/* 4X Metric */}
                  <div className="text-right opacity-80">
                    <div className="text-9xl sm:text-[12rem] md:text-[14rem] lg:text-[16rem] font-bold text-[#488AB5] leading-none mb-4">
                      <span className="stat-number" data-value="4">
                        0
                      </span>
                      <span className="text-gray-600 text-[4rem] sm:text-[6rem] md:text-[8rem] lg:text-[13rem]">
                        x
                      </span>
                    </div>
                    <div className="text-right -mt-8">
                      <h3 className="text-sm sm:text-base md:text-lg font-sora font-medium text-gray-900 mb-2 uppercase tracking-wide">
                        Higher Quality Candidates
                      </h3>
                      <p className="text-xs md:text-sm font-work font-normal text-gray-600 max-w-md leading-relaxed ml-auto">
                        Advanced assessment of thinking patterns, adaptability,
                        and modern skills through deeper evaluation methods
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Layout - Completely Restructured */}
            <div className="w-full max-w-md mx-auto px-6 relative z-10 sm:hidden">
              {/* Title at the top */}
              <div className="text-center mb-16">
                <h2 className="text-3xl font-sora font-medium text-gray-900 mb-4 leading-tight">
                  Measurable{" "}
                  <span className="text-[#488AB5] font-medium">Excellence</span>
                </h2>
                <p className="text-sm font-work text-gray-700 font-normal leading-relaxed">
                  Revolutionary assessment capabilities that transform how you
                  evaluate talent
                </p>
              </div>

              {/* First stat - 70% */}
              <div className="mb-20">
                {/* Big number centered */}
                <div className="text-center mb-8">
                  <div className="text-8xl font-bold text-[#488AB5] leading-none">
                    <span className="stat-number" data-value="70">
                      0
                    </span>
                    <span className="text-gray-600 text-5xl">%</span>
                  </div>
                </div>

                {/* Left-aligned text */}
                <div className="text-left">
                  <h3 className="text-lg font-sora font-medium text-gray-900 mb-3 uppercase tracking-wide">
                    Faster Evaluation
                  </h3>
                  <p className="text-sm font-work font-normal text-gray-600 leading-relaxed">
                    Dramatically accelerate your hiring process with AI-powered
                    interviews that scale effortlessly
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="w-full h-px bg-[#488AB5]/20 mb-20"></div>

              {/* Second stat - 4X */}
              <div>
                {/* Big number centered */}
                <div className="text-center mb-8">
                  <div className="text-8xl font-bold text-[#488AB5] leading-none">
                    <span className="stat-number" data-value="4">
                      0
                    </span>
                    <span className="text-gray-600 text-5xl">X</span>
                  </div>
                </div>

                {/* Left-aligned text */}
                <div className="text-left">
                  <h3 className="text-lg font-sora font-medium text-gray-900 mb-3 uppercase tracking-wide">
                    Higher Quality Candidates
                  </h3>
                  <p className="text-sm font-work font-normal text-gray-600 leading-relaxed">
                    Advanced assessment of thinking patterns, adaptability, and
                    modern skills through deeper evaluation methods
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Coming Soon Section */}
          <section
            ref={problemRef}
            className="relative h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-white overflow-hidden px-10"
          >
            {/* Subtle decorative elements */}
            <div className="absolute top-0 left-0 w-screen h-full pointer-events-none">
              {/* Top right arc */}
              <svg
                className="absolute top-16 right-8 w-32 h-32 opacity-10"
                viewBox="0 0 128 128"
              >
                <path
                  d="M20,20 Q108,20 108,108"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>

              {/* Bottom left geometric line */}
              <div className="absolute bottom-20 left-8">
                <div className="w-20 h-px bg-[#488AB5]/20 transform rotate-45"></div>
                <div className="w-12 h-px bg-[#488AB5]/30 transform -rotate-45 mt-2"></div>
              </div>

              {/* Center floating dot pattern */}
              <div className="absolute top-1/2 right-1/4 transform -translate-y-1/2">
                <div className="w-1 h-1 bg-[#488AB5]/30 rounded-full"></div>
                <div className="w-1 h-1 bg-[#488AB5]/20 rounded-full mt-3 ml-3"></div>
                <div className="w-1 h-1 bg-[#488AB5]/25 rounded-full mt-3 -ml-1"></div>
              </div>
            </div>

            <div className="w-full h-full relative z-10">
              {/* Top Left Content */}
              <div className="absolute top-24 left-16 max-w-md z-20">
                <div className="text-left space-y-6">
                  <div>
                    <div className="inline-block px-4 py-2 bg-[#488AB5]/10 text-[#488AB5] text-xs font-medium rounded-full mb-4 border border-[#488AB5]/20">
                      Coming Soon
                    </div>
                    <h2 className="problem-title text-sm sm:text-lg md:text-xl font-sora text-gray-900 mb-1 font-normal leading-tight">
                      Next-Generation{" "}
                      <span className="text-[#488AB5] font-medium">
                        AI Interviews
                      </span>
                    </h2>
                    <p className="text-xs sm:text-sm font-work text-gray-600 font-normal">
                      Experience the future of candidate evaluation with our
                      revolutionary AI interview platform.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {[
                      {
                        title: "AI Collaboration Assessment",
                        description:
                          "Evaluate how candidates work with AI tools to solve complex problems in real workplace scenarios.",
                      },
                      {
                        title: "Thought Process Analysis",
                        description:
                          "Understand how candidates think, reason, and approach challenges beyond just right answers.",
                      },
                    ].map((feature, index) => (
                      <div key={index} className="flex items-start space-x-4">
                        <div className="flex-shrink-0 w-2 h-2 border border-[#488AB5] rounded-full mt-2"></div>
                        <div>
                          <h3 className="text-sm font-sora font-normal text-gray-900 mb-1">
                            {feature.title}
                          </h3>
                          <p className="font-work font-normal text-gray-600 text-sm leading-relaxed">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Side Image */}
              <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 w-[77%]">
                <img
                  src="/assessment-interview.png"
                  alt="AI Interview Assessment Interface"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </section>

          {/* Pricing Section */}
          <section
            ref={pricingRef}
            id="pricing"
            className="relative min-h-screen py-16 sm:py-24 flex items-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-white overflow-hidden"
          >
            {/* Pricing decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Top left corner design */}
              <svg
                className="absolute top-8 left-8 w-24 h-24 opacity-15"
                viewBox="0 0 96 96"
              >
                <rect
                  x="10"
                  y="10"
                  width="76"
                  height="76"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                  rx="8"
                />
                <rect
                  x="20"
                  y="20"
                  width="56"
                  height="56"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                  rx="4"
                />
              </svg>

              {/* Right side vertical accents */}
              <div className="absolute top-1/4 right-6">
                <div className="w-px h-24 bg-gradient-to-b from-[#488AB5]/30 to-transparent"></div>
                <div className="w-px h-16 bg-gradient-to-b from-transparent to-[#488AB5]/20 mt-8"></div>
              </div>

              {/* Bottom scattered dots */}
              <div className="absolute bottom-16 left-1/3">
                <div className="w-1.5 h-1.5 bg-[#488AB5]/25 rounded-full"></div>
                <div className="w-1 h-1 bg-[#488AB5]/20 rounded-full mt-6 ml-8"></div>
                <div className="w-1.5 h-1.5 bg-[#488AB5]/30 rounded-full mt-4 ml-16"></div>
              </div>
            </div>

            <div className="w-full max-w-[70%] mx-auto px-4 sm:px-6 relative z-10">
              <div className="text-center mb-12 sm:mb-16 md:mb-24">
                <h2 className="pricing-title text-2xl sm:text-3xl md:text-4xl font-sora font-medium text-gray-900 mb-4 sm:mb-8">
                  Choose Your <span className="text-[#488AB5]">Plan</span>
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-10 md:gap-12 w-full mx-auto">
                {[
                  {
                    price: "Core",
                    period: "",
                    features: [
                      "6,200 Credits",
                      "Pay-as-you-go, Top up anytime",
                      "10 credits / interview minute",
                      "3 Seats",
                    ],
                    popular: false,
                  },
                  {
                    price: "Pro",
                    period: "",
                    features: [
                      "Everything in Core",
                      "25,000 credits",
                      "8 Credits / interview minute",
                      "10 seats",
                      "Advanced Analytics",
                      "Phone Interviews",
                    ],
                    popular: true,
                  },
                  {
                    price: "Enterprise",
                    period: "",
                    features: [
                      "Everything in Pro",
                      "5.5 Credits / interview minute",
                      "API Access",
                      "Unlimited Seats",
                      "White Labeling",
                    ],
                    popular: false,
                  },
                ].map((plan, index) => (
                  <div
                    key={index}
                    className={`pricing-card relative bg-white/90 p-6 sm:p-8 rounded-3xl shadow-lg border-2 flex flex-col h-full transition-all duration-300 hover:shadow-xl ${
                      plan.popular ? "border-[#488AB5]" : "border-white/50"
                    }`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white px-4 sm:px-6 py-1 sm:py-2 rounded-full font-sora font-medium text-xs sm:text-sm">
                        Most Popular
                      </div>
                    )}

                    <div className="text-center mb-2 sm:mb-4 md:mb-6 md:pt-1 lg:pt-2">
                      <div className="text-lg sm:text-2xl font-sora font-medium text-gray-900 opacity-80">
                        {plan.price}
                      </div>
                    </div>

                    <ul className="space-y-4 mb-8 flex-grow">
                      {plan.features.map((feature, idx) => (
                        <li
                          key={idx}
                          className="flex items-center text-sm font-work"
                        >
                          <Check className="w-4 h-4 text-[#488AB5] mr-3 ml-2 -mb-0.5 flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <Button
                      className={`w-full py-4 rounded-full font-work font-medium text-sm ${
                        plan.popular
                          ? "bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white"
                          : "border-3 border-[#488AB5] text-[#488AB5] hover:bg-[#488AB5] hover:text-white"
                      } transition-all duration-500`}
                      variant={plan.popular ? "solid" : "bordered"}
                      onMouseEnter={handleButtonEnter}
                      onMouseLeave={handleButtonLeave}
                      onClick={() =>
                        (window.location.href =
                          "https://cal.com/gsnmithra/meet")
                      }
                    >
                      Get Started
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Final CTA Section */}
          <section
            ref={ctaRef}
            className="relative min-h-screen py-16 sm:py-24 flex items-center justify-center bg-gradient-to-br from-white via-blue-50/30 to-[#488AB5]/10 overflow-hidden"
          >
            {/* Final section decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Top left thinking dots */}
              <div className="absolute top-16 left-16">
                <div className="flex items-center space-x-1 opacity-45">
                  <div className="cta-circle-1 w-3 h-3 bg-[#488AB5]/15 rounded-full opacity-60"></div>
                  <div className="cta-circle-2 w-16 h-16 bg-[#488AB5]/15 rounded-full opacity-50"></div>
                  <div className="cta-circle-3 w-32 h-32 bg-[#488AB5]/15 rounded-full opacity-40"></div>
                  <div className="cta-circle-4 w-52 h-52 bg-[#488AB5]/15 rounded-full opacity-30"></div>
                  <div className="cta-circle-5 w-96 h-96 bg-[#488AB5]/15 rounded-full opacity-20"></div>
                  <div className="cta-circle-6 w-[52rem] h-[52rem] bg-[#488AB5]/15 rounded-full opacity-10"></div>
                  <div className="cta-circle-7 w-[96rem] h-[96rem] bg-[#488AB5]/15 rounded-full opacity-5"></div>
                </div>
              </div>

              {/* Top right minimalist lines */}
              <div className="absolute top-20 right-16">
                <div className="w-8 h-px bg-[#488AB5]/20 mb-3"></div>
                <div className="w-12 h-px bg-[#488AB5]/15 mb-3"></div>
                <div className="w-6 h-px bg-[#488AB5]/25"></div>
              </div>

              {/* Center floating elements */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className="w-px h-20 bg-gradient-to-b from-transparent via-[#488AB5]/10 to-transparent transform rotate-45"></div>
                <div className="w-px h-20 bg-gradient-to-b from-transparent via-[#488AB5]/10 to-transparent transform -rotate-45 absolute top-0 left-0"></div>
              </div>

              {/* Bottom corner accent */}
              <svg
                className="absolute top-8 left-8 w-20 h-20 opacity-8"
                viewBox="0 0 80 80"
              >
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  stroke="#488AB5"
                  strokeWidth="1"
                  fill="none"
                  strokeDasharray="5,10"
                />
              </svg>
            </div>

            <div className="w-full max-w-[60%] mx-auto px-6 text-center relative z-10">
              <h2 className="cta-title text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-medium text-gray-900 mb-6 sm:mb-8 leading-tight px-4">
                Ready to Transform Hiring?
              </h2>

              <p className="cta-subtitle text-sm sm:text-md md:text-lg font-work font-normal text-gray-700 mb-6 sm:mb-10 max-w-3xl mx-auto leading-relaxed px-4">
                Join the future of recruitment. Start finding better candidates
                faster with Sivera's revolutionary AI interviews.
              </p>

              <div className="cta-buttons flex justify-center">
                <Button
                  size="lg"
                  className="cta-button bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white text-sm sm:text-md px-12 sm:px-8 md:px-10 py-3 sm:py-4 md:py-5 rounded-full font-work font-medium wide shadow-2xl transition-all duration-500 w-full sm:w-auto"
                  onMouseEnter={handleButtonEnter}
                  onMouseLeave={handleButtonLeave}
                  onClick={() =>
                    (window.location.href = "https://cal.com/gsnmithra/meet")
                  }
                >
                  Let’s Talk
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
};
