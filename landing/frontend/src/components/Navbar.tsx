import React, { useState, useRef, useEffect } from "react";
import { Button } from "@nextui-org/react";
import { Menu, X } from "lucide-react";
import { gsap } from "gsap";

interface NavbarProps {
  className?: string;
  isVisible?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  className = "",
  isVisible = false,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const ctaButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCtaButtonRef = useRef<HTMLButtonElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const animationStateRef = useRef<
    Map<HTMLElement, { isHovering: boolean; hoverComplete: boolean }>
  >(new Map());

  const navItems = [
    {
      label: "Pricing",
      href: "#pricing",
    },
    {
      label: "Demo",
      href: "https://www.youtube.com/watch?v=qetjdjGMFOo",
    },
    {
      label: "Register",
      href: "https://form.typeform.com/to/Z9Bdc24v",
    },
  ];

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleSmoothScroll = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (href.startsWith("#")) {
      e.preventDefault();
      const targetId = href.substring(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }
  };

  // GSAP animations for CTA button with ripple effect
  useEffect(() => {
    const buttons = [ctaButtonRef.current, mobileCtaButtonRef.current].filter(
      Boolean
    );

    buttons.forEach((button) => {
      if (!button) return;

      // Initialize animation state for this button
      animationStateRef.current.set(button, {
        isHovering: false,
        hoverComplete: false,
      });

      const handleMouseEnter = (e: MouseEvent) => {
        const state = animationStateRef.current.get(button);
        if (!state) return;

        state.isHovering = true;
        state.hoverComplete = false;

        // Scale and shadow animation with brand colors
        gsap.to(button, {
          backgroundColor: "#002B45", // Secondary brand color for hover
          boxShadow: "0 10px 25px rgba(72, 138, 181, 0.4)",
          duration: 1.3,
          ease: "power2.out",
          onComplete: () => {
            const currentState = animationStateRef.current.get(button);
            if (currentState) {
              currentState.hoverComplete = true;
              // If mouse has already left, trigger unhover
              if (!currentState.isHovering) {
                handleMouseLeave();
              }
            }
          },
        });

        // Create ripple effect
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Remove existing ripple if any
        const existingRipple = button.querySelector(".ripple-effect");
        if (existingRipple) {
          existingRipple.remove();
        }

        // Create ripple element
        const ripple = document.createElement("div");
        ripple.className = "ripple-effect";
        ripple.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          width: 0;
          height: 0;
          background: radial-gradient(circle, rgba(0, 43, 69, 0.25) 0%, rgba(0, 43, 69, 0.15) 40%, rgba(0, 43, 69, 0.08) 60%, rgba(0, 43, 69, 0.03) 80%, transparent 100%);
          border: 1px solid rgba(0, 43, 69, 0.1);
          border-radius: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 1;
        `;

        button.appendChild(ripple);

        // Animate ripple expansion
        gsap.to(ripple, {
          width: Math.max(rect.width, rect.height) * 2.5,
          height: Math.max(rect.width, rect.height) * 2.5,
          duration: 2.0,
          ease: "power2.out",
        });
      };

      const handleMouseLeave = () => {
        const state = animationStateRef.current.get(button);
        if (!state) return;

        state.isHovering = false;

        // Only proceed with unhover if hover animation is complete
        if (!state.hoverComplete) {
          return; // Wait for hover to complete
        }

        gsap.to(button, {
          backgroundColor: "", // Reset to original gradient
          boxShadow: "0 4px 15px rgba(72, 138, 181, 0.2)",
          duration: 1.3,
          ease: "power2.out",
          onComplete: () => {
            const currentState = animationStateRef.current.get(button);
            if (currentState) {
              currentState.hoverComplete = false;
            }
          },
        });

        // Remove ripple effect
        const ripple = button.querySelector(".ripple-effect");
        if (ripple) {
          gsap.to(ripple, {
            opacity: 0,
            duration: 2.0,
            ease: "power2.out",
            onComplete: () => {
              ripple.remove();
            },
          });
        }
      };

      button.addEventListener("mouseenter", handleMouseEnter);
      button.addEventListener("mouseleave", handleMouseLeave);

      // Cleanup
      return () => {
        button.removeEventListener("mouseenter", handleMouseEnter);
        button.removeEventListener("mouseleave", handleMouseLeave);
        animationStateRef.current.delete(button);
      };
    });
  }, []);

  // Water-like background animation
  useEffect(() => {
    if (backgroundRef.current && isVisible) {
      const background = backgroundRef.current;

      // Create a relaxing water-like movement
      const tl = gsap.timeline({ repeat: -1 });

      tl.to(background, {
        backgroundPosition: "110% 45%",
        duration: 6,
        ease: "sine.inOut",
      })
        .to(background, {
          backgroundPosition: "90% 55%",
          duration: 6,
          ease: "sine.inOut",
        })
        .to(background, {
          backgroundPosition: "105% 40%",
          duration: 6,
          ease: "sine.inOut",
        })
        .to(background, {
          backgroundPosition: "95% 60%",
          duration: 6,
          ease: "sine.inOut",
        })
        .to(background, {
          backgroundPosition: "100% 50%",
          duration: 6,
          ease: "sine.inOut",
        });

      return () => {
        tl.kill();
      };
    }
  }, [isVisible]);

  return (
    <>
      {/* Main Navbar */}
      <nav
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50
                    rounded-full border border-white/20 shadow-sm
                    transition-all duration-700 ease-out overflow-hidden
                    backdrop-blur-xl supports-[backdrop-filter]:bg-white/10
                    ${
                      isVisible
                        ? "w-[90%] sm:w-[80%] md:w-[70%] lg:w-[60%] xl:w-[50%] h-16 sm:h-14 opacity-100"
                        : "w-14 h-14 opacity-0 invisible"
                    }
                    ${className || ""}`}
      >
        {/* Background image layer (semi-transparent) */}
        <div
          ref={backgroundRef}
          className="absolute inset-0 pointer-events-none
                     bg-[url('/Banner.png')] bg-cover bg-no-repeat
                     opacity-20 [background-blend-mode:overlay] scale-x-[-1]"
          style={{ backgroundPosition: "0% 50%" }}
          aria-hidden="true"
        />

        {/* Soft tint to help contrast over busy images */}
        <div
          className="absolute inset-0 pointer-events-none bg-white/5"
          aria-hidden="true"
        />
        <div
          className={`w-full px-3 sm:px-4 md:px-6 transition-opacity duration-500 ${
            isVisible ? "opacity-100 delay-300" : "opacity-0"
          }`}
        >
          <div className="flex items-center justify-between h-16 sm:h-14">
            {/* Logo */}
            <div className="flex items-center flex-shrink-0">
              <img
                src="/SiveraTransparent.png"
                alt="SIVERA"
                className="h-10 w-10 sm:h-10 sm:w-10 opacity-80"
              />
            </div>

            {/* Mobile Let's Talk Button - Center */}
            <div className="md:hidden flex items-center justify-center flex-1 px-4">
              <Button
                ref={ctaButtonRef}
                size="sm"
                className="bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white px-4 py-2 rounded-full font-medium text-xs transition-all duration-300 shadow-lg hover:shadow-xl relative overflow-hidden group opacity-85 flex-shrink-0"
                onClick={() =>
                  (window.location.href = "https://cal.com/gsnmithra/meet")
                }
              >
                <span className="relative z-10 flex items-center gap-2">
                  Let's Talk
                </span>
              </Button>
            </div>

            {/* Desktop Navigation - Center */}
            <div className="hidden md:flex items-center space-x-3 absolute left-1/2 transform -translate-x-1/2">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-200/35 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border border-gray-200/50"
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel={
                    item.href.startsWith("http")
                      ? "noopener noreferrer"
                      : undefined
                  }
                  onClick={(e) => handleSmoothScroll(e, item.href)}
                >
                  {item.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA Button - Right */}
            <div className="hidden md:flex">
              <Button
                ref={ctaButtonRef}
                size="sm"
                className="bg-gradient-to-r from-[#488AB5] to-[#002B45] text-white px-6 py-2 rounded-full font-medium text-xs transition-all duration-300 shadow-lg hover:shadow-xl relative overflow-hidden group opacity-85"
                onClick={() =>
                  (window.location.href = "https://cal.com/gsnmithra/meet")
                }
              >
                <span className="relative z-10 flex items-center gap-2">
                  Let's Talk
                </span>
              </Button>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex-shrink-0">
              <button
                onClick={handleMobileMenuToggle}
                className="text-gray-700 hover:text-[#488AB5] inline-flex items-center justify-center p-2 rounded-md transition-colors duration-200"
              >
                {isMobileMenuOpen ? (
                  <X className="h-5 w-5 sm:h-6 sm:w-6" />
                ) : (
                  <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white/95 backdrop-blur-xl rounded-2xl mt-2 border border-gray-200/50 shadow-xl w-[95%] sm:w-[90%] mx-auto">
            <div className="px-4 pt-4 pb-4 space-y-2">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 block px-4 py-3 rounded-lg text-base font-medium transition-all duration-200"
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel={
                    item.href.startsWith("http")
                      ? "noopener noreferrer"
                      : undefined
                  }
                  onClick={(e) => {
                    handleSmoothScroll(e, item.href);
                    setIsMobileMenuOpen(false); // Close mobile menu after clicking
                  }}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </nav>
    </>
  );
};
