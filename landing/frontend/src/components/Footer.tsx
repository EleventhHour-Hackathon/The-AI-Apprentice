import { Linkedin, Twitter, Youtube, ChevronDown } from "lucide-react";
import { useState } from "react";

export const Footer = () => {
  const [openSections, setOpenSections] = useState({
    product: false,
    resources: false,
    company: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => {
      // If the clicked section is already open, close it
      if (prev[section]) {
        return {
          product: false,
          resources: false,
          company: false,
        };
      }
      // Otherwise, close all sections and open only the clicked one
      return {
        product: section === "product",
        resources: section === "resources",
        company: section === "company",
      };
    });
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
  return (
    <footer className="bg-white border-t border-gray-200/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-8 mb-8 sm:mb-12">
          {/* Brand Section */}
          <div className="lg:col-span-1 text-center sm:text-left mb-6">
            <div className="flex items-center justify-center sm:justify-start">
              <img
                src="/SiveraTransparent.png"
                alt="Sivera"
                className="h-9 w-auto opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            </div>
            <div className="flex space-x-4 justify-center sm:justify-start sm:pl-2 pt-3">
              <a
                href="https://www.linkedin.com/company/siveraio/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-[#488AB5] transition-colors duration-200"
                aria-label="LinkedIn"
              >
                <Linkedin className="w-4 h-4" />
              </a>
              <a
                href="https://x.com/SiveraOfficial"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-[#488AB5] transition-colors duration-200"
                aria-label="Twitter"
              >
                <Twitter className="w-4 h-4" />
              </a>
              <a
                href="https://www.youtube.com/@siveraio"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-[#488AB5] transition-colors duration-200"
                aria-label="YouTube"
              >
                <Youtube className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Product Section */}
          <div className="text-center sm:text-left">
            {/* Mobile Accordion Header */}
            <div className="sm:hidden">
              <button
                onClick={() => toggleSection("product")}
                className="flex items-center justify-between w-full bg-gray-50/80 hover:bg-gray-100/80 rounded-lg px-4 py-3 text-gray-900 font-medium text-sm transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[#488AB5]/20 border border-gray-200/50 transform hover:scale-[1.02]"
                aria-expanded={openSections.product}
              >
                <span className="flex items-center">
                  <div
                    className={`flex-shrink-0 w-2 h-2 border border-[#488AB5] ${
                      openSections.product ? "bg-[#488AB5]/30" : ""
                    } rounded-full mr-3 transition-all duration-300 ease-out`}
                  ></div>
                  Product
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-all duration-300 ${
                    openSections.product ? "rotate-180 text-[#488AB5]" : ""
                  }`}
                />
              </button>
            </div>

            {/* Desktop Header */}
            <h3 className="hidden sm:block text-gray-900 font-medium mb-4 text-sm">
              Product
            </h3>

            {/* Content */}
            <div
              className={`sm:block overflow-hidden transition-all duration-500 ease-in-out ${
                openSections.product
                  ? "max-h-96 opacity-100"
                  : "max-h-0 opacity-0"
              } sm:max-h-none sm:opacity-100`}
            >
              <div
                className={`sm:hidden mt-2 bg-white rounded-lg border border-gray-200/50 shadow-sm transform transition-all duration-400 ease-out ${
                  openSections.product
                    ? "translate-y-0 scale-100"
                    : "-translate-y-2 scale-95"
                }`}
              >
                <ul className="space-y-1 text-xs font-light p-4">
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      AI Interviews
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Analytics
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Pipeline Management
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Integrations
                    </a>
                  </li>
                  <li>
                    <a
                      href="#pricing"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                      onClick={(e) => handleSmoothScroll(e, "#pricing")}
                    >
                      Pricing
                    </a>
                  </li>
                </ul>
              </div>
              <ul className="hidden sm:block space-y-3 text-xs font-extralight pb-4 sm:pb-0">
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    AI Interviews
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Analytics
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Pipeline Management
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Integrations
                  </a>
                </li>
                <li>
                  <a
                    href="#pricing"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                    onClick={(e) => handleSmoothScroll(e, "#pricing")}
                  >
                    Pricing
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Resources Section */}
          <div className="text-center sm:text-left">
            {/* Mobile Accordion Header */}
            <div className="sm:hidden">
              <button
                onClick={() => toggleSection("resources")}
                className="flex items-center justify-between w-full bg-gray-50/80 hover:bg-gray-100/80 rounded-lg px-4 py-3 text-gray-900 font-medium text-sm transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[#488AB5]/20 border border-gray-200/50 transform hover:scale-[1.02]"
                aria-expanded={openSections.resources}
              >
                <span className="flex items-center">
                  <div
                    className={`flex-shrink-0 w-2 h-2 border border-[#488AB5] ${
                      openSections.resources ? "bg-[#488AB5]/30" : ""
                    } rounded-full mr-3 transition-all duration-300 ease-out`}
                  ></div>
                  Resources
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-all duration-300 ${
                    openSections.resources ? "rotate-180 text-[#488AB5]" : ""
                  }`}
                />
              </button>
            </div>

            {/* Desktop Header */}
            <h3 className="hidden sm:block text-gray-900 font-medium mb-4 text-sm">
              Resources
            </h3>

            {/* Content */}
            <div
              className={`sm:block overflow-hidden transition-all duration-500 ease-in-out ${
                openSections.resources
                  ? "max-h-96 opacity-100"
                  : "max-h-0 opacity-0"
              } sm:max-h-none sm:opacity-100`}
            >
              <div
                className={`sm:hidden mt-2 bg-white rounded-lg border border-gray-200/50 shadow-sm transform transition-all duration-400 ease-out ${
                  openSections.resources
                    ? "translate-y-0 scale-100"
                    : "-translate-y-2 scale-95"
                }`}
              >
                <ul className="space-y-1 text-xs font-light p-4">
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Documentation
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      API Reference
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Help Center
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Blog
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Case Studies
                    </a>
                  </li>
                </ul>
              </div>
              <ul className="hidden sm:block space-y-3 text-xs font-extralight pb-4 sm:pb-0">
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Documentation
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    API Reference
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Help Center
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Blog
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Case Studies
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Company Section */}
          <div className="text-center sm:text-left">
            {/* Mobile Accordion Header */}
            <div className="sm:hidden">
              <button
                onClick={() => toggleSection("company")}
                className="flex items-center justify-between w-full bg-gray-50/80 hover:bg-gray-100/80 rounded-lg px-4 py-3 text-gray-900 font-medium text-sm transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[#488AB5]/20 border border-gray-200/50 transform hover:scale-[1.02]"
                aria-expanded={openSections.company}
              >
                <span className="flex items-center">
                  <div
                    className={`flex-shrink-0 w-2 h-2 border border-[#488AB5] ${
                      openSections.company ? "bg-[#488AB5]/30" : ""
                    } rounded-full mr-3 transition-all duration-300 ease-out`}
                  ></div>
                  Company
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-all duration-300 ${
                    openSections.company ? "rotate-180 text-[#488AB5]" : ""
                  }`}
                />
              </button>
            </div>

            {/* Desktop Header */}
            <h3 className="hidden sm:block text-gray-900 font-medium mb-4 text-sm">
              Company
            </h3>

            {/* Content */}
            <div
              className={`sm:block overflow-hidden transition-all duration-500 ease-in-out ${
                openSections.company
                  ? "max-h-96 opacity-100"
                  : "max-h-0 opacity-0"
              } sm:max-h-none sm:opacity-100`}
            >
              <div
                className={`sm:hidden mt-2 bg-white rounded-lg border border-gray-200/50 shadow-sm transform transition-all duration-400 ease-out ${
                  openSections.company
                    ? "translate-y-0 scale-100"
                    : "-translate-y-2 scale-95"
                }`}
              >
                <ul className="space-y-1 text-xs font-light p-4">
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      About Us
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Careers
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Contact
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Privacy Policy
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      className="block text-gray-600 hover:text-[#488AB5] hover:bg-gray-50 rounded-md px-3 py-2 transition-all duration-200"
                    >
                      Terms of Service
                    </a>
                  </li>
                </ul>
              </div>
              <ul className="hidden sm:block space-y-3 text-xs font-extralight pb-4 sm:pb-0">
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    About Us
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Careers
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Contact
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-gray-600 hover:text-[#488AB5] transition-colors duration-200"
                  >
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="pt-3 sm:pt-6 border-t border-gray-200 flex justify-center">
          <div className="flex flex-col md:flex-row justify-between items-center text-xs text-gray-600 font-extralight text-center">
            © 2025 Sivera. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
};
